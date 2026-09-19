import * as assert from "assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DomainError,
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
  ExecutionCancelledError,
  Executor,
  FileRunStore,
  FileScheduleStore,
  PipelineEngine,
  Runtime,
  Scheduler,
  RUN_INTERRUPTED_ERROR,
  type DispatchStatus,
} from "../../src/runtime/index.js";
import type { NodeAction } from "../../src/runtime/Executor.js";
import type { StoredNodeRun, StoredRun } from "../../src/runtime/persistence/RunStore.js";

const tempDirs: string[] = [];

function tmpdirPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sprintdesk-recovery-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
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

function pendingAction(): NodeAction {
  return {
    type: "pending",
    run: async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new ExecutionCancelledError();
    },
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Runtime interrupt/recovery contract", () => {
  it("leaves persisted terminal runs unchanged", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save(seededRun("ok", "succeeded", [nodeRun("a", "counter", "succeeded")], { finishedAt: 130 }));
    store.save(seededRun("boom", "failed", [nodeRun("a", "counter", "failed", { error: "boom" })], { error: "boom", finishedAt: 130 }));
    store.save(seededRun("gone", "cancelled", [nodeRun("a", "counter", "cancelled")], { finishedAt: 130 }));

    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });

    const succeeded = runtime.status("ok");
    assert.strictEqual(succeeded.status, "succeeded");
    assert.strictEqual(succeeded.finishedAt, 130);
    assert.strictEqual(succeeded.error, undefined);
    assert.strictEqual(succeeded.nodes.find((node) => node.nodeId === "a")?.status, "succeeded"); // node history preserved
    const failed = runtime.status("boom");
    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.error, "boom");
    assert.strictEqual(failed.nodes.find((node) => node.nodeId === "a")?.status, "failed");
    assert.strictEqual(failed.nodes.find((node) => node.nodeId === "a")?.error, "boom");
    assert.strictEqual(runtime.status("gone").status, "cancelled");
    assert.strictEqual(runtime.status("gone").nodes.find((node) => node.nodeId === "a")?.status, "cancelled");
  });

  it("recovers a persisted queued run to failed with the interrupt error", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save(seededRun("q", "queued", [nodeRun("a", "counter", "queued")]));

    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });

    const info = runtime.status("q");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
    assert.ok(info.finishedAt !== undefined);
  });

  it("recovers a persisted running run and settles its active node runs", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    const started = 100;
    store.save(
      seededRun("r", "running", [
        nodeRun("done", "counter", "succeeded", { startedAt: 110, finishedAt: 120, stateVersion: 3 }),
        nodeRun("mid", "counter", "running", { startedAt: 130 }),
        nodeRun("wait", "counter", "queued"),
      ])
    );

    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });

    const info = runtime.status("r");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
    assert.ok((info.finishedAt ?? 0) >= started);

    const done = info.nodes.find((node) => node.nodeId === "done");
    const mid = info.nodes.find((node) => node.nodeId === "mid");
    const wait = info.nodes.find((node) => node.nodeId === "wait");
    assert.strictEqual(done?.status, "succeeded"); // terminal node runs preserved
    assert.strictEqual(done?.stateVersion, 3);
    assert.strictEqual(mid?.status, "cancelled"); // active node runs cancelled
    assert.ok(mid?.finishedAt !== undefined);
    assert.strictEqual(wait?.status, "cancelled");
    assert.ok(wait?.finishedAt !== undefined);

    assert.strictEqual(store.get("r")?.status, "failed"); // recovery is persisted
    assert.strictEqual(store.get("r")?.finishedAt, info.finishedAt);
  });

  it("recover() is idempotent and re-settling is a no-op", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save(seededRun("r", "running", [nodeRun("mid", "counter", "running")]));

    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });

    await runtime.recover();
    const first = runtime.status("r");
    assert.strictEqual(first.status, "failed");
    assert.strictEqual(first.error, RUN_INTERRUPTED_ERROR);

    await runtime.recover();
    const second = runtime.status("r");
    assert.strictEqual(second.status, "failed");
    assert.strictEqual(second.error, RUN_INTERRUPTED_ERROR);
    assert.strictEqual(second.finishedAt, first.finishedAt);
  });

  it("settles a persisted run once and does not re-run it as a live execution", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save(seededRun("once", "running", [nodeRun("mid", "counter", "running")]));

    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });
    const info = runtime.status("once");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
  });
});

describe("Dispatcher restart semantics", () => {
  it("a fresh Dispatcher starts with an empty in-memory queue", () => {
    const registry = new PipelineRegistry();
    registry.register(new Pipeline({ id: "p", name: "P", versions: [counterVersion()] }));
    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }) });
    const first = new Dispatcher({ engine: new PipelineEngine(registry, runtime), runtime });
    const oldId = first.dispatch({ pipelineId: "p", version: 1 });
    assert.strictEqual(first.list().length, 1);

    const second = new Dispatcher({ engine: new PipelineEngine(registry, runtime), runtime });
    assert.strictEqual(second.list().length, 0); // queue is in-memory by design
    assert.throws(
      () => second.status(oldId),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("an in-flight dispatch's underlying runtime run is recovered after restart", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save(
      seededRun("admitted", "running", [
        nodeRun("done", "counter", "succeeded"),
        nodeRun("fly", "counter", "running"),
      ])
    );

    // Fresh Runtime over the same store auto-recovers the persisted run.
    const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore: store });
    const info = runtime.status("admitted");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
    assert.strictEqual(info.nodes.find((node) => node.nodeId === "done")?.status, "succeeded");
    assert.strictEqual(info.nodes.find((node) => node.nodeId === "fly")?.status, "cancelled");
  });

  it("a never-admitted dispatch leaves no persisted run and is not recreated after restart", async () => {
    const runFilePath = join(tmpdirPath(), "runs.json");
    const runStore = new FileRunStore({ filePath: runFilePath });
    const registry = new PipelineRegistry();
    registry.register(new Pipeline({ id: "p", name: "P", versions: [counterVersion()] }));
    const runtime = new Runtime({ executor: new Executor({ actions: [pendingAction()] }), runStore });
    const dispatcher = new Dispatcher({ engine: new PipelineEngine(registry, runtime), runtime });

    // The single slot is taken by a request that stays running, so the second
    // request is never admitted to the engine.
    const admittedId = dispatcher.dispatch({ pipelineId: "p", version: 1 });
    await waitForDispatchStatus(dispatcher, admittedId, "running");
    const admittedRunId = dispatcher.status(admittedId).runId as string;
    const queuedId = dispatcher.dispatch({ pipelineId: "p", version: 1 });
    assert.strictEqual(dispatcher.status(queuedId).status, "queued");
    assert.strictEqual(dispatcher.status(queuedId).runId, undefined); // never admitted
    assert.strictEqual(runStore.list().length, 1); // only the admitted run is persisted

    // Restart: a fresh Dispatcher does not reconstruct the queued request.
    const runtime2 = new Runtime({ executor: new Executor({ actions: [counterAction()] }), runStore });
    const dispatcher2 = new Dispatcher({ engine: new PipelineEngine(registry, runtime2), runtime: runtime2 });
    assert.strictEqual(dispatcher2.list().length, 0);
    assert.throws(
      () => dispatcher2.status(queuedId),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
    assert.throws(
      () => dispatcher2.status(admittedId),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );

    // The persisted admitted run is recovered by the fresh Runtime.
    const recovered = runtime2.status(admittedRunId);
    assert.strictEqual(recovered.status, "failed");
    assert.strictEqual(recovered.error, RUN_INTERRUPTED_ERROR);

    await runtime.cancel(admittedRunId); // settle the still-pending run
  });
});

interface SchedulerEnv {
  readonly bus: EventBus;
  readonly registry: PipelineRegistry;
  readonly runtime: Runtime;
  readonly engine: PipelineEngine;
  readonly dispatcher: Dispatcher;
  readonly scheduler: Scheduler;
  readonly scheduleFilePath: string;
}

function schedulerEnv(bus: EventBus): SchedulerEnv {
  const scheduleFilePath = join(tmpdirPath(), "schedules.json");
  const registry = new PipelineRegistry();
  registry.register(new Pipeline({ id: "p", name: "P", versions: [counterVersion()] }));
  const runtime = new Runtime({ executor: new Executor({ actions: [counterAction()] }) });
  const engine = new PipelineEngine(registry, runtime);
  const dispatcher = new Dispatcher({ engine, runtime });
  const scheduler = new Scheduler({
    dispatcher,
    eventBus: bus,
    scheduleStore: new FileScheduleStore({ filePath: scheduleFilePath }),
  });
  return { bus, registry, runtime, engine, dispatcher, scheduler, scheduleFilePath };
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
    await delay(10);
  }
}

async function waitForDispatchStatus(
  dispatcher: Dispatcher,
  id: string,
  expected: DispatchStatus,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (dispatcher.status(id).status === expected) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for dispatch "${id}" to reach "${expected}"`);
    }
    await delay(10);
  }
}

describe("Scheduler restart re-arm", () => {
  it("restores exactly one interval timer across restart (no duplicate cadence)", async () => {
    const bus = new EventBus();
    const env = schedulerEnv(bus);
    // first lifetime
    env.scheduler.schedule({ id: "int", pipelineId: "p", trigger: { type: "interval", everyMs: 30 } });
    env.scheduler.start();
    await waitForDispatchCount(env.dispatcher, 1);

    // restart: fresh Scheduler over the same schedule store
    env.scheduler.stop();
    const scheduler2 = new Scheduler({
      dispatcher: env.dispatcher,
      eventBus: bus,
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
    assert.ok(cadence >= 15, `expected a single interval cadence, got ${cadence}ms gap`);
  });

  it("restores exactly one event subscription across restart", () => {
    const bus = new EventBus();
    const env = schedulerEnv(bus);
    env.scheduler.schedule({ id: "evt", pipelineId: "p", trigger: { type: "event", eventType: "tick" } });
    env.scheduler.start();

    // restart: fresh Scheduler over the same schedule store; a single publish
    // must yield exactly one dispatch.
    env.scheduler.stop();
    const scheduler2 = new Scheduler({
      dispatcher: env.dispatcher,
      eventBus: bus,
      scheduleStore: new FileScheduleStore({ filePath: env.scheduleFilePath }),
    });
    scheduler2.start();

    bus.publish("tick");
    assert.strictEqual(env.dispatcher.list().length, 1);
  });

  it("does not re-arm disabled interval schedules", async () => {
    const bus = new EventBus();
    const env = schedulerEnv(bus);
    env.scheduler.schedule({ id: "off", pipelineId: "p", trigger: { type: "interval", everyMs: 10 }, enabled: false });
    env.scheduler.start();
    await delay(50);
    assert.strictEqual(env.dispatcher.list().length, 0);
  });

  it("does not re-subscribe disabled event schedules", () => {
    const bus = new EventBus();
    const env = schedulerEnv(bus);
    env.scheduler.schedule({ id: "offevt", pipelineId: "p", trigger: { type: "event", eventType: "tick" }, enabled: false });
    env.scheduler.start();
    env.scheduler.stop();
    const scheduler2 = new Scheduler({
      dispatcher: env.dispatcher,
      eventBus: bus,
      scheduleStore: new FileScheduleStore({ filePath: env.scheduleFilePath }),
    });
    scheduler2.start();
    bus.publish("tick");
    assert.strictEqual(env.dispatcher.list().length, 0);
  });
});