import * as assert from "assert";
import {
  InProcessExecutionBackend,
  Runtime,
  type ExecutionBackend,
  type ExecuteOptions,
  type NodeAction,
} from "../../src/runtime/index.js";
import { Executor } from "../../src/runtime/Executor.js";
import { Graph, Node, PipelineVersion, State, StateSchema } from "../../src/kernel/index.js";

describe("ExecutionBackend", () => {
  const mockAction: NodeAction = {
    type: "mock",
    run: ({ state }) => state.withValue("result", "ok"),
  };

  const schema = new StateSchema({ name: "backend-test", fields: { result: { type: "string", required: false } } });
  const version = new PipelineVersion({
    version: 1,
    stateSchema: schema,
    graph: new Graph({ nodes: [new Node({ id: "node1", type: "mock" })], edges: [] }),
  });

  it("matches direct Executor execution", async () => {
    const executor = new Executor({ actions: [mockAction] });
    const backend = new InProcessExecutionBackend(executor);
    const initialState = new State({ schema, value: {} });
    const direct = await executor.execute(version, { id: "direct", initialState });
    const execution = await backend.execute(version, { id: "backend", initialState });

    assert.strictEqual(execution.status, "succeeded");
    assert.deepStrictEqual(execution.run.result?.finalState, direct.run.result?.finalState);
    assert.deepStrictEqual([...execution.nodes.keys()], ["node1"]);
    assert.strictEqual(execution.nodes.get("node1")?.attempts.length, direct.nodes.get("node1")?.attempts.length);
  });

  it("Runtime delegates with its owned AbortSignal", async () => {
    let received: ExecuteOptions | undefined;
    const backend: ExecutionBackend = {
      execute: async (candidate, options) => {
        received = options;
        return new Executor({ actions: [mockAction] }).execute(candidate, options);
      },
    };
    const runtime = new Runtime({ backend });
    const execution = await runtime.execute(version, { id: "injected" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(received?.id, "injected");
    assert.ok(received?.signal instanceof AbortSignal);
  });

  it("uses the default in-process backend", async () => {
    const runtime = new Runtime({ executor: new Executor({ actions: [mockAction] }) });
    const execution = await runtime.execute(version);

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(runtime.backend instanceof InProcessExecutionBackend, true);
  });

  it("records an injected backend failure as a run-level failure", async () => {
    const backend: ExecutionBackend = {
      execute: async () => {
        throw new Error("backend unavailable");
      },
    };
    const runtime = new Runtime({ backend });

    try {
      await runtime.execute(version, { id: "backend-failure" });
      assert.fail("Expected the backend failure to reject");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.strictEqual((error as Error).message, "backend unavailable");
    }
    assert.strictEqual(runtime.status("backend-failure").status, "failed");
    assert.strictEqual(runtime.status("backend-failure").error, "backend unavailable");
  });
});