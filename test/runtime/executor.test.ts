import * as assert from "assert";
import {
  DomainError,
  EventBus,
  Graph,
  Node,
  PipelineVersion,
  State,
  StateSchema,
  type SchemaField,
} from "../../src/kernel/index.js";
import { Executor, ExecutionCancelledError, type NodeAction } from "../../src/runtime/index.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "runtime", fields });
}

function versionOf(edges: string[][]): PipelineVersion {
  const ids = [...new Set(edges.flat())];
  const nodes = ids.map((id, index) => new Node({ id, type: index === ids.length - 1 ? "noop" : "counter" }));
  return new PipelineVersion({
    version: 1,
    graph: new Graph({
      nodes,
      edges: edges.map(([from, to]) => ({ from, to }) as { from: string; to: string }),
    }),
    stateSchema: schema({
      count: { type: "number", required: false },
      label: { type: "string", required: false },
    }),
  });
}

function counterAction(): NodeAction {
  return {
    type: "counter",
    run: ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
  };
}

function noopAction(): NodeAction {
  return { type: "noop", run: ({ state }) => state };
}

function singleNodeVersion(type: string): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes: [new Node({ id: "a", type })], edges: [] }),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runtime/Executor", () => {
  it("executes a linear graph deterministically thread-by-thread", async () => {
    const executor = new Executor({ actions: [counterAction(), noopAction()] });
    const version = versionOf([["a", "b"], ["b", "c"], ["c", "d"]]);
    const execution = await executor.execute(version, { id: "x1" });

    assert.strictEqual(execution.status, "succeeded");
    const finalState = execution.run.result?.finalState as State;
    assert.strictEqual(finalState.get("count"), 3);
  });

  it("executes branched graphs in topological order", async () => {
    const visited: string[] = [];
    const stateSchema = schema({ count: { type: "number" } });
    const record: NodeAction = {
      type: "record",
      run: ({ node, state }) => {
        visited.push(node.id);
        return state;
      },
    };
    const nodes = ["start", "left", "right", "sink"].map((id) => new Node({ id, type: "record" }));
    const graph = new Graph({
      nodes,
      edges: [
        { from: "start", to: "left" },
        { from: "start", to: "right" },
        { from: "left", to: "sink" },
        { from: "right", to: "sink" },
      ],
    });
    const version = new PipelineVersion({
      version: 1,
      graph,
      stateSchema,
    });
    const execution = await new Executor({ actions: [record] }).execute(version, {
      id: "branched",
      initialState: new State({ schema: stateSchema, value: { count: 0 } }),
    });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(visited[0], "start");
    assert.strictEqual(visited[3], "sink");
    assert.ok(visited.indexOf("left") < visited.indexOf("sink"));
    assert.ok(visited.indexOf("right") < visited.indexOf("sink"));
  });

  it("is deterministic: same input yields the same outcome", async () => {
    const executor = new Executor({ actions: [counterAction(), noopAction()] });
    const version = versionOf([["a", "b"], ["b", "c"]]);
    const first = await executor.execute(version, { id: "d1" });
    const second = await executor.execute(version, { id: "d2" });

    assert.strictEqual(first.status, second.status);
    assert.strictEqual((first.run.result?.finalState as State).get("count"), (second.run.result?.finalState as State).get("count"));
  });

  it("succeeds an empty graph with the initial state", async () => {
    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [], edges: [] }),
      stateSchema: schema(),
    });
    const initialState = new State({ schema: version.stateSchema, value: {} });
    const execution = await new Executor().execute(version, { id: "empty", initialState });
    assert.strictEqual(execution.status, "succeeded");
  });

  it("fails the run when no action is registered for a node type", async () => {
    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "a", type: "missing" })], edges: [] }),
      stateSchema: schema(),
    });
    const execution = await new Executor().execute(version, { id: "missing" });
    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /missing/);
  });

  it("fails the run when an action returns an incompatible state schema", async () => {
    const bad = new StateSchema({ name: "other" });
    const wrong: NodeAction = {
      type: "wrong",
      run: () => new State({ schema: bad, value: {} }),
    };
    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "a", type: "wrong" })], edges: [] }),
      stateSchema: schema({ count: { type: "number" } }),
    });
    const execution = await new Executor({ actions: [wrong] }).execute(version, {
      id: "wrong",
      initialState: new State({ schema: version.stateSchema, value: { count: 0 } }),
    });
    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /schema/i);
  });

  it("throws up front on an initial state schema mismatch", async () => {
    const version = versionOf([]);
    const executor = new Executor({ actions: [counterAction()] });
    await assert.rejects(
      () => executor.execute(version, { id: "bad-init", initialState: new State({ schema: schema(), value: {} }) }),
      (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_VIOLATION"
    );
  });

  it("emits lifecycle events on the event bus", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event) => types.push(event.type));

    const version = versionOf([["a", "b"]]);
    const execution = await new Executor({ actions: [counterAction(), noopAction()] }).execute(version, {
      id: "events",
      eventBus: bus,
    });

    assert.strictEqual(execution.status, "succeeded");
    assert.deepStrictEqual(types, [
      "execution.run.started",
      "execution.node.started",
      "execution.node.finished",
      "execution.node.started",
      "execution.node.finished",
      "execution.run.finished",
    ]);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });

  it("supports async actions", async () => {
    const asyncAction: NodeAction = {
      type: "async",
      run: async ({ state }) =>
        new Promise<State>((resolve) =>
          setTimeout(() => resolve(state.withValue("count", (state.get<number>("count") ?? 0) + 10)), 5)
        ),
    };
    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "a", type: "async" })], edges: [] }),
      stateSchema: schema({ count: { type: "number" } }),
    });
    const execution = await new Executor({ actions: [asyncAction] }).execute(version, {
      id: "async",
      initialState: new State({ schema: version.stateSchema, value: { count: 0 } }),
    });
    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual((execution.run.result?.finalState as State).get("count"), 10);
  });

  it("register returns a new executor merging actions", async () => {
    const executor = new Executor({ actions: [counterAction()] });
    const extended = executor.register(noopAction());
    assert.strictEqual(executor.actions.size, 1);
    assert.strictEqual(extended.actions.size, 2);

    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "sink", type: "noop" })], edges: [] }),
      stateSchema: schema({ count: { type: "number" } }),
    });
    const execution = await extended.execute(version, {
      id: "reg",
      initialState: new State({ schema: version.stateSchema, value: { count: 1 } }),
    });
    assert.strictEqual(execution.status, "succeeded");
  });

  it("rejects duplicate action types", () => {
    assert.throws(() => new Executor({ actions: [counterAction(), counterAction()] }), /already registered/);
  });

  it("injects the abort signal into every action input", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const observe: NodeAction = {
      type: "observe",
      run: ({ signal, state }) => {
        received = signal;
        return state;
      },
    };
    const version = singleNodeVersion("observe");
    const execution = await new Executor({ actions: [observe] }).execute(version, {
      id: "signal-seen",
      signal: controller.signal,
    });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(received, controller.signal);
    assert.strictEqual(received?.aborted, false);
  });

  it("provides a default non-aborted signal when none is supplied", async () => {
    let received: AbortSignal | undefined;
    const observe: NodeAction = {
      type: "observe",
      run: ({ signal, state }) => {
        received = signal;
        return state;
      },
    };
    const execution = await new Executor({ actions: [observe] }).execute(singleNodeVersion("observe"), {
      id: "signal-default",
    });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(received instanceof AbortSignal);
    assert.strictEqual(received?.aborted, false);
  });

  it("cancels immediately when started with an already-aborted signal", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event) => types.push(event.type));
    const controller = new AbortController();
    controller.abort();

    const execution = await new Executor({ actions: [counterAction()] }).execute(singleNodeVersion("counter"), {
      id: "pre-aborted",
      signal: controller.signal,
      eventBus: bus,
    });

    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    assert.deepStrictEqual(types, ["execution.run.started", "execution.run.cancelled"]);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });

  it("commits cancelled, not failed, when an action throws ExecutionCancelledError", async () => {
    const bus = new EventBus();
    const deliberate: NodeAction = {
      type: "deliberate",
      run: () => {
        throw new ExecutionCancelledError("stopped by request");
      },
    };
    const execution = await new Executor({ actions: [deliberate] }).execute(singleNodeVersion("deliberate"), {
      id: "deliberate-cancel",
      eventBus: bus,
    });

    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });

  it("cancels a node mid-run: started, node.started, then cancelled, without failure", async () => {
    const gate = deferred<State>();
    const blocked: NodeAction = {
      type: "blocked",
      run: async ({ state }) => {
        await gate.promise;
        return state;
      },
    };
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event) => types.push(event.type));
    const controller = new AbortController();
    const nodeStarted = new Promise<void>((resolve) => bus.once("execution.node.started", () => resolve()));

    const running = new Executor({ actions: [blocked] }).execute(singleNodeVersion("blocked"), {
      id: "mid-run",
      signal: controller.signal,
      eventBus: bus,
    });

    await nodeStarted;
    controller.abort();
    gate.resolve(new State({ schema: schema({ count: { type: "number", required: false } }), value: {} }));

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    assert.deepStrictEqual(types, [
      "execution.run.started",
      "execution.node.started",
      "execution.run.cancelled",
    ]);
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });
});