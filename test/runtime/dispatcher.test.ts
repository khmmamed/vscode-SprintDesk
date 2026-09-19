import * as assert from "assert";
import {
  DomainError,
  EventBus,
  Graph,
  Node,
  Pipeline,
  PipelineRegistry,
  PipelineVersion,
  State,
  StateSchema,
  type Execution,
} from "../../src/kernel/index.js";
import {
  Dispatcher,
  ExecutionCancelledError,
  Executor,
  PipelineEngine,
  Runtime,
  type DispatchRequest,
  type DispatchStatus,
  type DispatchStatusInfo,
} from "../../src/runtime/index.js";
import type { NodeAction, NodeInput } from "../../src/runtime/Executor.js";

function schema(): StateSchema {
  return new StateSchema({ name: "dispatch", fields: { counter: { type: "number", required: false } } });
}

function version(...types: string[]): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes: types.map((type, index) => new Node({ id: `n${index}`, type })) }),
    stateSchema: schema(),
  });
}

function incAction(type: string): NodeAction {
  return {
    type,
    run: async ({ state }) => state.withValue("counter", (state.get<number>("counter") ?? 0) + 1),
  };
}

interface Gate {
  readonly action: NodeAction;
  readonly started: Promise<void>;
  readonly nodeStarted: () => boolean;
  readonly release: () => void;
  readonly fail: (error: unknown) => void;
}

function gate(type: string): Gate {
  let startedFlag = false;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let resolveWork: (state: State) => void = () => {};
  let rejectWork: (reason: unknown) => void = () => {};
  const work = new Promise<State>((resolve, reject) => {
    resolveWork = resolve;
    rejectWork = reject;
  });
  let input: State | undefined;
  const action: NodeAction = {
    type,
    run: (nodeInput: NodeInput) => {
      input = nodeInput.state;
      startedFlag = true;
      markStarted();
      return new Promise<State>((resolve, reject) => {
        nodeInput.signal.addEventListener("abort", () => reject(new ExecutionCancelledError()), { once: true });
        work.then(resolve, reject);
      });
    },
  };
  return {
    action,
    started,
    nodeStarted: () => startedFlag,
    release: () => resolveWork(input as State),
    fail: (error) => rejectWork(error),
  };
}

interface Meta {
  readonly registry: PipelineRegistry;
  readonly runtime: Runtime;
  readonly engine: PipelineEngine;
  readonly dispatcher: Dispatcher;
  readonly gates: ReadonlyMap<string, Gate>;
}

function makeMeta(
  prepare: (gates: Map<string, Gate>, actions: NodeAction[]) => void,
  maxConcurrentRuns = 1
): Meta {
  const gates = new Map<string, Gate>();
  const actions: NodeAction[] = [];
  prepare(gates, actions);
  const registry = new PipelineRegistry();
  const runtime = new Runtime({ executor: new Executor({ actions }), eventBus: new EventBus() });
  const engine = new PipelineEngine(registry, runtime);
  const dispatcher = new Dispatcher({ engine, runtime, maxConcurrentRuns });
  return { registry, runtime, engine, dispatcher, gates };
}

function addGate(gates: Map<string, Gate>, actions: NodeAction[], type: string): Gate {
  const g = gate(type);
  gates.set(type, g);
  actions.push(g.action);
  return g;
}

function registerPipeline(meta: Meta, id: string, nodeTypes: readonly string[]): void {
  meta.registry.register(
    new Pipeline({
      id,
      name: id,
      versions: [version(...nodeTypes)],
    })
  );
}

async function waitFor(
  dispatcher: Dispatcher,
  id: string,
  status: DispatchStatus,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (dispatcher.status(id).status === status) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for dispatch "${id}" to reach "${status}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settled(dispatcher: Dispatcher, id: string, timeoutMs = 2000): Promise<DispatchStatusInfo> {
  const start = Date.now();
  while (true) {
    const info = dispatcher.status(id);
    if (info.status === "succeeded" || info.status === "failed" || info.status === "cancelled") {
      return info;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for dispatch "${id}" to settle`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Dispatcher", () => {
  it("rejects invalid maxConcurrentRuns values", () => {
    const runtime = new Runtime({ executor: new Executor({ actions: [] }) });
    const engine = {} as unknown as PipelineEngine;
    for (const value of [0, -1, NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(
        () => new Dispatcher({ engine, runtime, maxConcurrentRuns: value }),
        (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
      );
    }
  });

  it("defaults to a single concurrent run", async () => {
    const meta = makeMeta((gates, actions) => {
      addGate(gates, actions, "gA");
      addGate(gates, actions, "gB");
    });
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);
    const dispatcher = new Dispatcher({ engine: meta.engine, runtime: meta.runtime });

    const aId = dispatcher.dispatch({ pipelineId: "a" });
    const bId = dispatcher.dispatch({ pipelineId: "b" });
    await meta.gates.get("gA")?.started;
    assert.strictEqual(dispatcher.status(aId).status, "running");
    assert.strictEqual(dispatcher.status(bId).status, "queued");
    assert.strictEqual(meta.gates.get("gB")?.nodeStarted(), false);
  });

  it("returns a dispatch id immediately and tracks the full success lifecycle", async () => {
    const meta = makeMeta((_gates, actions) => actions.push(incAction("inc")));
    registerPipeline(meta, "p", ["inc"]);
    const dispatchId = meta.dispatcher.dispatch({ pipelineId: "p" });

    assert.ok(dispatchId.startsWith("dispatch-"));
    assert.strictEqual(meta.dispatcher.status(dispatchId).status, "running");
    await waitFor(meta.dispatcher, dispatchId, "succeeded");

    const info = meta.dispatcher.status(dispatchId);
    assert.strictEqual(info.id, dispatchId);
    assert.strictEqual(info.pipelineId, "p");
    assert.strictEqual(info.version, undefined);
    assert.ok(info.queuedAt > 0);
    assert.ok((info.startedAt ?? 0) >= info.queuedAt);
    assert.ok((info.finishedAt ?? 0) >= (info.startedAt ?? 0));
    assert.ok(info.runId);
    assert.ok(info.runId.startsWith("run-"));
    assert.notStrictEqual(info.runId, dispatchId);
    assert.strictEqual(info.error, undefined);

    const runInfo = meta.runtime.status(info.runId as string);
    assert.strictEqual(runInfo.id, info.runId);
    assert.strictEqual(runInfo.execution?.run.id, `${info.runId}:run`);
  });

  it("honors an explicit request id as the run identity", async () => {
    const meta = makeMeta((_gates, actions) => actions.push(incAction("inc")));
    registerPipeline(meta, "p", ["inc"]);
    const dispatchId = meta.dispatcher.dispatch({ pipelineId: "p", id: "explicit-run" });
    await settled(meta.dispatcher, dispatchId);

    const info = meta.dispatcher.status(dispatchId);
    assert.strictEqual(info.status, "succeeded");
    assert.strictEqual(info.runId, "explicit-run");
    assert.strictEqual(meta.runtime.status("explicit-run").id, "explicit-run");
    assert.strictEqual(meta.runtime.status("explicit-run").execution?.run.id, "explicit-run:run");
  });

  it("marks a failing run as failed and preserves the error", async () => {
    const meta = makeMeta((gates, actions) => addGate(gates, actions, "gA"));
    registerPipeline(meta, "p", ["gA"]);
    const dispatchId = meta.dispatcher.dispatch({ pipelineId: "p" });
    await meta.gates.get("gA")?.started;
    meta.gates.get("gA")?.fail(new Error("boom"));

    const info = await settled(meta.dispatcher, dispatchId);
    assert.strictEqual(info.status, "failed");
    assert.match(info.error ?? "", /boom/);
  });

  it("marks a request failed when the engine rejects", async () => {
    const meta = makeMeta((_gates, _actions) => {});
    const dispatchId = meta.dispatcher.dispatch({ pipelineId: "missing" });

    const info = await settled(meta.dispatcher, dispatchId);
    assert.strictEqual(info.status, "failed");
    assert.match(info.error ?? "", /Pipeline with id "missing" not found/);
  });

  it("runs queued requests strictly in FIFO order", async () => {
    const meta = makeMeta((gates, actions) => {
      addGate(gates, actions, "gA");
      addGate(gates, actions, "gB");
      addGate(gates, actions, "gC");
    });
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);
    registerPipeline(meta, "c", ["gC"]);

    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "b" });
    const cId = meta.dispatcher.dispatch({ pipelineId: "c" });
    await meta.gates.get("gA")?.started;

    assert.strictEqual(meta.dispatcher.status(bId).status, "queued");
    assert.strictEqual(meta.dispatcher.status(cId).status, "queued");

    meta.gates.get("gA")?.release();
    await waitFor(meta.dispatcher, aId, "succeeded");
    await meta.gates.get("gB")?.started;
    assert.strictEqual(meta.dispatcher.status(bId).status, "running");
    assert.strictEqual(meta.dispatcher.status(cId).status, "queued");

    meta.gates.get("gB")?.release();
    await waitFor(meta.dispatcher, bId, "succeeded");
    await meta.gates.get("gC")?.started;
    meta.gates.get("gC")?.release();
    await waitFor(meta.dispatcher, cId, "succeeded");

    assert.strictEqual(meta.dispatcher.status(aId).status, "succeeded");
    assert.strictEqual(meta.dispatcher.status(bId).status, "succeeded");
    assert.strictEqual(meta.dispatcher.status(cId).status, "succeeded");
  });

  it("enforces maxConcurrentRuns and admits the next queued request on completion", async () => {
    const meta = makeMeta(
      (gates, actions) => {
        addGate(gates, actions, "gA");
        addGate(gates, actions, "gB");
        addGate(gates, actions, "gC");
      },
      2
    );
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);
    registerPipeline(meta, "c", ["gC"]);

    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "b" });
    const cId = meta.dispatcher.dispatch({ pipelineId: "c" });
    await meta.gates.get("gA")?.started;
    await meta.gates.get("gB")?.started;

    assert.strictEqual(meta.dispatcher.status(aId).status, "running");
    assert.strictEqual(meta.dispatcher.status(bId).status, "running");
    assert.strictEqual(meta.dispatcher.status(cId).status, "queued");
    assert.strictEqual(meta.gates.get("gC")?.nodeStarted(), false);

    meta.gates.get("gA")?.release();
    await waitFor(meta.dispatcher, aId, "succeeded");
    await meta.gates.get("gC")?.started;
    assert.strictEqual(meta.dispatcher.status(cId).status, "running");
    assert.strictEqual(meta.dispatcher.status(bId).status, "running");

    meta.gates.get("gB")?.release();
    meta.gates.get("gC")?.release();
    await waitFor(meta.dispatcher, bId, "succeeded");
    await waitFor(meta.dispatcher, cId, "succeeded");
  });

  it("cancels a queued request without it ever reaching the engine", async () => {
    const meta = makeMeta((gates, actions) => {
      addGate(gates, actions, "gA");
      addGate(gates, actions, "gB");
    });
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);

    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "b" });
    await meta.gates.get("gA")?.started;
    const aRunId = meta.dispatcher.status(aId).runId;
    assert.strictEqual(meta.dispatcher.cancel(bId), true);

    const info = meta.dispatcher.status(bId);
    assert.strictEqual(info.status, "cancelled");
    assert.ok((info.finishedAt ?? 0) >= info.queuedAt);
    assert.strictEqual(info.runId, undefined);
    assert.strictEqual(meta.gates.get("gB")?.nodeStarted(), false);
    assert.strictEqual(meta.runtime.runs().length, 1);
    assert.strictEqual(meta.runtime.runs()[0]?.id, aRunId);

    meta.gates.get("gA")?.release();
    await waitFor(meta.dispatcher, aId, "succeeded");
    assert.strictEqual(meta.dispatcher.status(bId).status, "cancelled");
    assert.strictEqual(meta.runtime.runs().length, 1);
  });

  it("cancels a running request, reflects it as cancelled, and frees the slot", async () => {
    const meta = makeMeta((gates, actions) => {
      addGate(gates, actions, "gA");
      addGate(gates, actions, "gB");
    });
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);

    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "b" });
    await meta.gates.get("gA")?.started;
    assert.strictEqual(meta.dispatcher.cancel(aId), true);

    const info = await settled(meta.dispatcher, aId);
    assert.strictEqual(info.status, "cancelled");
    assert.ok(info.runId);
    assert.strictEqual(meta.runtime.status(info.runId as string).status, "cancelled");

    await meta.gates.get("gB")?.started;
    assert.strictEqual(meta.dispatcher.status(bId).status, "running");
    meta.gates.get("gB")?.release();
    await waitFor(meta.dispatcher, bId, "succeeded");
  });

  it("cancelling a request immediately after dispatch settles as cancelled", async () => {
    const meta = makeMeta((gates, actions) => addGate(gates, actions, "gA"));
    registerPipeline(meta, "a", ["gA"]);
    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    await meta.gates.get("gA")?.started;

    assert.strictEqual(meta.dispatcher.cancel(aId), true);
    const info = await settled(meta.dispatcher, aId);
    assert.strictEqual(info.status, "cancelled");
  });

  it("returns false when cancelling a terminal request and throws for an unknown id", async () => {
    const meta = makeMeta((_gates, actions) => actions.push(incAction("inc")));
    registerPipeline(meta, "p", ["inc"]);
    const dispatchId = meta.dispatcher.dispatch({ pipelineId: "p" });
    await waitFor(meta.dispatcher, dispatchId, "succeeded");

    assert.strictEqual(meta.dispatcher.cancel(dispatchId), false);
    assert.throws(
      () => meta.dispatcher.cancel("not-a-dispatch"),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
    assert.throws(
      () => meta.dispatcher.status("nope"),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("cancels one running request without disturbing another", async () => {
    const meta = makeMeta(
      (gates, actions) => {
        addGate(gates, actions, "gA");
        addGate(gates, actions, "gB");
      },
      2
    );
    registerPipeline(meta, "a", ["gA"]);
    registerPipeline(meta, "b", ["gB"]);

    const aId = meta.dispatcher.dispatch({ pipelineId: "a" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "b" });
    await meta.gates.get("gA")?.started;
    await meta.gates.get("gB")?.started;

    assert.strictEqual(meta.dispatcher.cancel(aId), true);
    const aInfo = await settled(meta.dispatcher, aId);
    assert.strictEqual(aInfo.status, "cancelled");
    assert.strictEqual(meta.dispatcher.status(bId).status, "running");

    meta.gates.get("gB")?.release();
    await waitFor(meta.dispatcher, bId, "succeeded");
  });

  it("isolates failures: a failed run and an engine rejection do not block the queue", async () => {
    const meta = makeMeta((gates, actions) => {
      addGate(gates, actions, "gFail");
      addGate(gates, actions, "gOk");
    });
    registerPipeline(meta, "failing", ["gFail"]);
    registerPipeline(meta, "ok", ["gOk"]);

    const missingId = meta.dispatcher.dispatch({ pipelineId: "missing" });
    const failId = meta.dispatcher.dispatch({ pipelineId: "failing" });
    await settled(meta.dispatcher, missingId);
    await meta.gates.get("gFail")?.started;
    meta.gates.get("gFail")?.fail(new Error("kaboom"));

    const okId = meta.dispatcher.dispatch({ pipelineId: "ok" });
    const failInfo = await settled(meta.dispatcher, failId);
    assert.strictEqual(failInfo.status, "failed");
    assert.match(failInfo.error ?? "", /kaboom/);

    await meta.gates.get("gOk")?.started;
    assert.strictEqual(meta.dispatcher.status(missingId).status, "failed");
    assert.strictEqual(meta.dispatcher.status(okId).status, "running");
    meta.gates.get("gOk")?.release();
    await waitFor(meta.dispatcher, okId, "succeeded");
  });

  it("lists requests in admission order with their current statuses", async () => {
    const meta = makeMeta((_gates, actions) => actions.push(incAction("inc")));
    registerPipeline(meta, "p", ["inc"]);
    assert.deepStrictEqual(meta.dispatcher.list(), []);

    const aId = meta.dispatcher.dispatch({ pipelineId: "p" });
    const bId = meta.dispatcher.dispatch({ pipelineId: "p" });
    assert.deepStrictEqual(
      meta.dispatcher.list().map((info) => info.id),
      [aId, bId]
    );
    await waitFor(meta.dispatcher, aId, "succeeded");
    await waitFor(meta.dispatcher, bId, "succeeded");
    assert.strictEqual(meta.dispatcher.list()[0]?.status, "succeeded");
    assert.strictEqual(meta.dispatcher.list()[1]?.status, "succeeded");
  });

  it("dispatches exclusively through the engine and never starts runs directly", async () => {
    const runCalls: DispatchRequest[] = [];
    const startCalls: DispatchRequest[] = [];
    const runtime = new Runtime({ executor: new Executor({ actions: [] }) });
    const stubEngine = {
      async run(request: DispatchRequest): Promise<Execution> {
        runCalls.push(request);
        return {
          id: request.id as string,
          version: version("inc"),
          initialState: new State({ schema: schema(), value: {} }),
          nodes: new Map(),
          status: "succeeded",
          run: { id: `${request.id}:run`, status: "succeeded", startedAt: 1, finishedAt: 2 },
        } as unknown as Execution;
      },
      start(request: DispatchRequest): string {
        startCalls.push(request);
        return "started";
      },
    } as unknown as PipelineEngine;
    const dispatcher = new Dispatcher({ engine: stubEngine, runtime });

    const dispatchId = dispatcher.dispatch({ pipelineId: "p" });
    await waitFor(dispatcher, dispatchId, "succeeded");

    assert.strictEqual(runCalls.length, 1);
    assert.strictEqual(runCalls[0]?.pipelineId, "p");
    assert.strictEqual(runCalls[0]?.id, dispatcher.status(dispatchId).runId);
    assert.strictEqual(startCalls.length, 0);
    assert.strictEqual(runtime.runs().length, 0);
  });
});