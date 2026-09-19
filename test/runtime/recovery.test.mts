import { expect } from "chai";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import {
  EventBus,
  Graph,
  Node,
  Pipeline,
  PipelineRegistry,
  PipelineVersion,
  StateSchema,
} from "../../src/kernel/index.js";
import {
  Dispatcher,
  Executor,
  FileRunStore,
  FileScheduleStore,
  PipelineEngine,
  Runtime,
  RUN_INTERRUPTED_ERROR,
  Scheduler,
} from "../../src/runtime/index.js";
import type { NodeAction } from "../../src/runtime/Executor.js";
import type { StoredNodeRun, StoredRun } from "../../src/runtime/persistence/RunStore.js";

describe("Recovery Semantics", () => {
  let tempDir: string;
  let runStorePath: string;
  let scheduleStorePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprintdesk-recovery-"));
    runStorePath = path.join(tempDir, "runs.json");
    scheduleStorePath = path.join(tempDir, "schedules.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function schema(): StateSchema {
    return new StateSchema({ name: "recovery", fields: { count: { type: "number", required: false } } });
  }

  function counterVersion(): PipelineVersion {
    return new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "a", type: "counter" })] }),
      stateSchema: schema(),
    });
  }

  function counterAction(): NodeAction {
    return {
      type: "counter",
      run: async ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
    };
  }

  function nodeRun(
    nodeId: string,
    nodeType: string,
    status: StoredNodeRun["status"],
    patch: Partial<Omit<StoredNodeRun, "nodeId" | "nodeType" | "status">> = {}
  ): StoredNodeRun {
    return { nodeId, nodeType, status, ...patch };
  }

  function seededRun(
    id: string,
    status: StoredRun["status"],
    nodes: StoredNodeRun[],
    patch: Partial<Omit<StoredRun, "id" | "status" | "nodes">> = {}
  ): StoredRun {
    return { id, status, nodes, startedAt: 100, ...patch };
  }

  describe("Runtime Recovery", () => {
    it("recover non-terminal runs and preserve terminal runs", () => {
      const store = new FileRunStore({ filePath: runStorePath });

      store.save({ id: "run-succeeded", status: "succeeded", startedAt: 1000, finishedAt: 2000, nodes: [] });
      store.save(
        seededRun("run-running", "running", [
          nodeRun("n1", "counter", "running", { startedAt: 1100 }),
          nodeRun("n2", "counter", "queued"),
          nodeRun("n3", "counter", "succeeded", { startedAt: 1000, finishedAt: 1050, stateVersion: 1 }),
        ])
      );
      store.save({ id: "run-queued", status: "queued", nodes: [] });

      const runtime = new Runtime({ executor: new Executor(), runStore: store });

      const succeeded = runtime.status("run-succeeded");
      expect(succeeded.status).to.equal("succeeded");
      expect(succeeded.finishedAt).to.equal(2000);

      const recoveredRunning = runtime.status("run-running");
      expect(recoveredRunning.status).to.equal("failed");
      expect(recoveredRunning.error).to.equal(RUN_INTERRUPTED_ERROR);
      expect(recoveredRunning.finishedAt).to.not.be.undefined;

      const nodeRuns = recoveredRunning.nodes;
      const n1 = nodeRuns.find((n) => n.nodeId === "n1");
      const n2 = nodeRuns.find((n) => n.nodeId === "n2");
      const n3 = nodeRuns.find((n) => n.nodeId === "n3");
      expect(n1?.status).to.equal("cancelled");
      expect(n1?.finishedAt).to.not.be.undefined;
      expect(n2?.status).to.equal("cancelled");
      expect(n2?.finishedAt).to.not.be.undefined;
      expect(n3?.status).to.equal("succeeded");
      expect(n3?.finishedAt).to.equal(1050);
      expect(n3?.stateVersion).to.equal(1);

      const recoveredQueued = runtime.status("run-queued");
      expect(recoveredQueued.status).to.equal("failed");
      expect(recoveredQueued.error).to.equal(RUN_INTERRUPTED_ERROR);
    });

    it("is idempotent", async () => {
      const store = new FileRunStore({ filePath: runStorePath });
      store.save(seededRun("run-1", "running", [nodeRun("n1", "counter", "running")]));

      const runtime = new Runtime({ executor: new Executor(), runStore: store });
      const firstFinishedAt = runtime.status("run-1").finishedAt;

      await runtime.recover();
      const secondFinishedAt = runtime.status("run-1").finishedAt;

      expect(secondFinishedAt).to.equal(firstFinishedAt);
    });
  });

  describe("Scheduler Re-arm", () => {
    function schedulerEnv(): {
      readonly dispatcher: Dispatcher;
      readonly scheduler: Scheduler;
      readonly scheduleFilePath: string;
    } {
      const registry = new PipelineRegistry();
      registry.register(new Pipeline({ id: "p", name: "P", versions: [counterVersion()] }));
      const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }) });
      const engine = new PipelineEngine(registry, runtime);
      const dispatcher = new Dispatcher({ engine, runtime });
      const scheduler = new Scheduler({
        dispatcher,
        scheduleStore: new FileScheduleStore({ filePath: scheduleStorePath }),
      });
      return { dispatcher, scheduler, scheduleFilePath: scheduleStorePath };
    }

    async function waitForDispatchCount(dispatcher: Dispatcher, expected: number, timeoutMs = 3000): Promise<void> {
      const start = Date.now();
      while (true) {
        if (dispatcher.list().length >= expected) {
          return;
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Timed out waiting for at least ${expected} dispatches (got ${dispatcher.list().length})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    it("re-arms interval schedules exactly once", async () => {
      const env = schedulerEnv();
      env.scheduler.schedule({ id: "sched-1", pipelineId: "p", trigger: { type: "interval", everyMs: 30 } });
      env.scheduler.start();
      await waitForDispatchCount(env.dispatcher, 1);

      env.scheduler.stop();
      const scheduler2 = new Scheduler({
        dispatcher: env.dispatcher,
        scheduleStore: new FileScheduleStore({ filePath: env.scheduleFilePath }),
      });
      scheduler2.start();
      await waitForDispatchCount(env.dispatcher, 2);
      await waitForDispatchCount(env.dispatcher, 3);

      const queued = env.dispatcher
        .list()
        .map((entry) => entry.queuedAt)
        .sort((a, b) => a - b);
      const cadence = queued[queued.length - 1] - queued[queued.length - 2];
      expect(cadence).to.be.at.least(15);
    });

    it("re-subscribes event schedules exactly once", () => {
      const bus = new EventBus();
      const registry = new PipelineRegistry();
      registry.register(new Pipeline({ id: "p", name: "P", versions: [counterVersion()] }));
      const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }) });
      const engine = new PipelineEngine(registry, runtime);
      const dispatcher = new Dispatcher({ engine, runtime });
      const scheduler = new Scheduler({
        dispatcher,
        eventBus: bus,
        scheduleStore: new FileScheduleStore({ filePath: scheduleStorePath }),
      });

      scheduler.schedule({ id: "sched-event", pipelineId: "p", trigger: { type: "event", eventType: "tick" } });
      scheduler.start();
      scheduler.stop();
      const scheduler2 = new Scheduler({
        dispatcher,
        eventBus: bus,
        scheduleStore: new FileScheduleStore({ filePath: scheduleStorePath }),
      });
      scheduler2.start();

      bus.publish("tick");
      expect(dispatcher.list().length).to.equal(1);
    });

    it("does not re-arm disabled schedules", async () => {
      const env = schedulerEnv();
      env.scheduler.schedule({ id: "sched-disabled", pipelineId: "p", trigger: { type: "interval", everyMs: 10 }, enabled: false });
      env.scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(env.dispatcher.list().length).to.equal(0);
    });
  });
});