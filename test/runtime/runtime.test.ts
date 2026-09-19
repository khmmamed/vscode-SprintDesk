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
  type Event,
} from "../../src/kernel/index.js";
import { Executor, ExecutionCancelledError, Runtime, type NodeAction } from "../../src/runtime/index.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "runtime", fields });
}

function graphOf(nodes: Array<{ id: string; type: string }>, edges: string[][] = []): Graph {
  return new Graph({
    nodes: nodes.map(({ id, type }) => new Node({ id, type })),
    edges: edges.map(([from, to]) => ({ from, to }) as { from: string; to: string }),
  });
}

function counterVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([{ id: "counter", type: "counter" }]),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function twoCounterVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([
      { id: "counter-a", type: "counter" },
      { id: "counter-b", type: "counter" },
    ]),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function failingVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([{ id: "boom", type: "boom" }]),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function counterAction(): NodeAction {
  return {
    type: "counter",
    run: ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
  };
}

function boomAction(): NodeAction {
  return {
    type: "boom",
    run: () => {
      throw new Error("boom");
    },
  };
}

function counterRuntime(extraActions: readonly NodeAction[] = []): Runtime {
  return new Runtime({ executor: new Executor({ actions: [counterAction(), ...extraActions] }) });
}

function versionWithType(type: string): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([{ id: type, type }]),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function deferred(): { readonly promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function awaitedAction(type: string): NodeAction {
  return {
    type,
    run: ({ state, signal }) =>
      new Promise<State>((resolve) => signal.addEventListener("abort", () => resolve(state), { once: true })),
  };
}

async function waitForExecution(runtime: Runtime, id: string, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.status(id).execution) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`run "${id}" did not complete in time`);
}

async function waitForStatus(runtime: Runtime, id: string, status: string, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.status(id).status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`run "${id}" did not reach status "${status}" in time`);
}

describe("runtime/Runtime", () => {
  it("starts a run and tracks it to completion", async () => {
    const runtime = counterRuntime();
    const id = runtime.start(counterVersion());
    assert.ok(id.length > 0);
    assert.strictEqual(runtime.status(id).status, "queued");
    await waitForStatus(runtime, id, "succeeded");
    const info = runtime.status(id);
    assert.strictEqual(info.status, "succeeded");
    assert.ok(info.startedAt !== undefined);
    assert.ok(info.finishedAt !== undefined);
    assert.strictEqual((info.execution?.run.result?.finalState as State)?.get("count"), 1);
  });

  it("executes a run and returns the final execution", async () => {
    const runtime = counterRuntime();
    const execution = await runtime.execute(counterVersion(), { id: "exec-1" });
    assert.strictEqual(execution.status, "succeeded");
    const info = runtime.status("exec-1");
    assert.strictEqual(info.status, "succeeded");
    assert.strictEqual((execution.run.result?.finalState as State).get("count"), 1);
  });

  it("records a failed execution", async () => {
    const runtime = counterRuntime([boomAction()]);
    const execution = await runtime.execute(failingVersion());
    assert.strictEqual(execution.status, "failed");
    const info = runtime.status(execution.id);
    assert.strictEqual(info.status, "failed");
    assert.ok(info.error);
  });

  it("reports status by run id", async () => {
    const runtime = counterRuntime();
    const id = runtime.start(counterVersion());
    await waitForStatus(runtime, id, "succeeded");
    const info = runtime.status(id);
    assert.strictEqual(info.id, id);
    assert.strictEqual(info.status, "succeeded");
  });

  it("throws on unknown run id", () => {
    const runtime = counterRuntime();
    assert.throws(() => runtime.status("nope"), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
      return true;
    });
  });

  it("supports multiple independent runs", async () => {
    const runtime = counterRuntime();
    const a = runtime.start(counterVersion(), { id: "multi-a" });
    const b = runtime.start(counterVersion(), { id: "multi-b" });
    const c = await runtime.execute(twoCounterVersion(), { id: "multi-c" });

    await waitForStatus(runtime, a, "succeeded");
    await waitForStatus(runtime, b, "succeeded");

    assert.strictEqual((runtime.status(a).execution?.run.result?.finalState as State)?.get("count"), 1);
    assert.strictEqual((runtime.status(b).execution?.run.result?.finalState as State)?.get("count"), 1);
    assert.strictEqual((c.run.result?.finalState as State).get("count"), 2);
    assert.strictEqual(runtime.runs().length, 3);
  });

  it("keeps runs isolated from each other", async () => {
    const runtime = counterRuntime([boomAction()]);
    const a = await runtime.execute(counterVersion(), { id: "iso-ok" });
    const b = await runtime.execute(failingVersion(), { id: "iso-fail" });

    assert.strictEqual(a.status, "succeeded");
    assert.strictEqual(runtime.status("iso-ok").status, "succeeded");
    assert.strictEqual(b.status, "failed");
    assert.strictEqual(runtime.status("iso-fail").status, "failed");
    assert.strictEqual((a.run.result?.finalState as State).get("count"), 1);
  });

  it("publishes runtime and execution events through the event bus", async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.onAny((event: Event) => events.push(event.type));

    const runtime = counterRuntime();
    const id = await waitForFinished(runtime, bus, counterVersion());

    assert.strictEqual(runtime.status(id).status, "succeeded");
    assert.deepStrictEqual(events, [
      "runtime.run.started",
      "execution.run.started",
      "execution.node.started",
      "execution.node.finished",
      "execution.run.finished",
    ]);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });

  it("rejects duplicate run ids", async () => {
    const runtime = counterRuntime();
    runtime.start(counterVersion(), { id: "dup" });
    await assert.rejects(() => runtime.execute(counterVersion(), { id: "dup" }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "DUPLICATE_ID");
      return true;
    });
  });

  it("cancels a run while it is still queued", async () => {
    const runtime = counterRuntime();
    const id = runtime.start(counterVersion());
    assert.strictEqual(runtime.status(id).status, "queued");

    assert.strictEqual(runtime.cancel(id), true);
    await waitForExecution(runtime, id);

    const info = runtime.status(id);
    assert.strictEqual(info.status, "cancelled");
    assert.strictEqual(info.execution?.status, "cancelled");
    assert.strictEqual(info.error, undefined);
  });

  it("cancels an in-flight run through its abort signal", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event: Event) => types.push(event.type));
    const runtime = new Runtime({ executor: new Executor({ actions: [awaitedAction("awaited")] }) });
    const id = runtime.start(versionWithType("awaited"), { eventBus: bus });

    await waitForStatus(runtime, id, "running");
    assert.strictEqual(runtime.cancel(id), true);
    await waitForStatus(runtime, id, "cancelled");

    const info = runtime.status(id);
    assert.strictEqual(info.status, "cancelled");
    assert.strictEqual(info.error, undefined);
    assert.deepStrictEqual(types.slice(0, 3), [
      "runtime.run.started",
      "execution.run.started",
      "execution.node.started",
    ]);
    assert.strictEqual(types[types.length - 1], "execution.run.cancelled");
    assert.strictEqual(bus.historyOf("execution.run.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });

  it("commits cancelled when the running action cooperatively throws ExecutionCancelledError", async () => {
    const gate = deferred();
    const cooperative: NodeAction = {
      type: "cooperative",
      run: async ({ state, signal }) => {
        await gate.promise;
        if (signal.aborted) {
          throw new ExecutionCancelledError();
        }
        return state;
      },
    };
    const runtime = new Runtime({ executor: new Executor({ actions: [cooperative] }) });
    const bus = new EventBus();
    const id = runtime.start(versionWithType("cooperative"), { eventBus: bus });

    await waitForStatus(runtime, id, "running");
    assert.strictEqual(runtime.cancel(id), true);
    gate.resolve();
    await waitForStatus(runtime, id, "cancelled");

    const info = runtime.status(id);
    assert.strictEqual(info.execution?.status, "cancelled");
    assert.strictEqual(info.error, undefined);
  });

  it("returns false and keeps the result when cancelling a finished run", async () => {
    const runtime = counterRuntime();
    const id = runtime.start(counterVersion());
    await waitForStatus(runtime, id, "succeeded");

    assert.strictEqual(runtime.cancel(id), false);
    const info = runtime.status(id);
    assert.strictEqual(info.status, "succeeded");
    assert.strictEqual((info.execution?.run.result?.finalState as State).get("count"), 1);
  });

  it("is idempotent: re-cancelling an already-cancelled run is a no-op", async () => {
    const runtime = counterRuntime();
    const id = runtime.start(counterVersion());
    assert.strictEqual(runtime.cancel(id), true);
    await waitForExecution(runtime, id);

    assert.strictEqual(runtime.cancel(id), false);
    assert.strictEqual(runtime.status(id).status, "cancelled");
  });

  it("throws on cancel for an unknown run id", () => {
    const runtime = counterRuntime();
    assert.throws(() => runtime.cancel("nope"), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
      return true;
    });
  });
});

function waitForFinished(runtime: Runtime, bus: EventBus, version: PipelineVersion, id = "events-1"): Promise<string> {
  return new Promise((resolve, reject) => {
    bus.once("execution.run.finished", () => {
      resolve(id);
    });
    runtime.start(version, { id, eventBus: bus });
  });
}