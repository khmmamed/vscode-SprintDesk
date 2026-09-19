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
} from "../../src/kernel/index.js";
import { ExecutionCancelledError } from "../../src/runtime/Executor.js";
import { Executor, Runtime } from "../../src/runtime/index.js";
import { PipelineEngine } from "../../src/runtime/PipelineEngine.js";
import type { NodeAction, NodeInput } from "../../src/runtime/Executor.js";
import { DevHarness } from "../../src/dev/harness.js";

function schema(): StateSchema {
  return new StateSchema({ name: "engine", fields: { counter: { type: "number", required: false } } });
}

function node(options: ConstructorParameters<typeof Node>[0]): Node {
  return new Node(options);
}

function makeVersion(version: number, ...nodes: Node[]): PipelineVersion {
  return new PipelineVersion({ version, graph: new Graph({ nodes }), stateSchema: schema() });
}

function incAction(type: string): NodeAction {
  return {
    type,
    run: async ({ state }) => state.withValue("counter", (state.get<number>("counter") ?? 0) + 1),
  };
}

function slowAction(type: string): NodeAction {
  return {
    type,
    run: ({ signal }: NodeInput) =>
      new Promise<State>((_, reject) => {
        signal.addEventListener("abort", () => reject(new ExecutionCancelledError()), { once: true });
      }),
  };
}

function setup(versions: PipelineVersion[]): { engine: PipelineEngine; registry: PipelineRegistry; runtime: Runtime; pipeline: Pipeline } {
  const registry = new PipelineRegistry();
  const pipeline = new Pipeline({ id: "e", name: "Engine Pipeline", versions });
  registry.register(pipeline);
  const runtime = new Runtime({ executor: new Executor({ actions: [incAction("inc")] }) });
  const engine = new PipelineEngine(registry, runtime);
  return { engine, registry, runtime, pipeline };
}

async function waitUntil(runtime: Runtime, id: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    const status = runtime.status(id).status;
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for run "${id}" to finish`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("PipelineEngine", () => {
  it("resolves the latest version and runs the pipeline", async () => {
    const { engine, runtime, pipeline } = setup([makeVersion(1, node({ id: "a", type: "inc" })), makeVersion(2, node({ id: "a", type: "inc" }), node({ id: "b", type: "inc" }))]);
    const execution = await engine.run({ pipelineId: pipeline.id });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(execution.version.version, 2);
    assert.strictEqual(execution.run.pipelineId, "e");
    assert.strictEqual(execution.run.pipelineVersion, 2);
    assert.strictEqual(execution.nodes.get("a")?.status, "succeeded");
    assert.strictEqual(execution.nodes.get("b")?.status, "succeeded");
    assert.strictEqual(runtime.status(execution.id).pipelineId, "e");
  });

  it("runs an explicit version when requested", async () => {
    const { engine, pipeline } = setup([makeVersion(1, node({ id: "a", type: "inc" })), makeVersion(2, node({ id: "a", type: "inc" }), node({ id: "b", type: "inc" }))]);
    const execution = await engine.run({ pipelineId: pipeline.id, version: 1 });

    assert.strictEqual(execution.version.version, 1);
    assert.strictEqual(execution.run.pipelineVersion, 1);
    assert.strictEqual(execution.nodes.size, 1);
  });

  it("propagates NOT_FOUND for an unknown pipeline", async () => {
    const { engine } = setup([]);
    await assert.rejects(
      engine.run({ pipelineId: "missing" }),
      (error) => error instanceof DomainError && error.code === "NOT_FOUND"
    );
  });

  it("rejects a pipeline with no executable version", async () => {
    const { engine, pipeline } = setup([]);
    await assert.rejects(
      engine.run({ pipelineId: pipeline.id }),
      (error) =>
        error instanceof DomainError &&
        error.code === "NOT_FOUND" &&
        /no executable version/.test(error.message)
    );
  });

  it("rejects an explicit version that does not exist", async () => {
    const { engine, pipeline } = setup([makeVersion(1, node({ id: "a", type: "inc" }))]);
    await assert.rejects(
      engine.run({ pipelineId: pipeline.id, version: 99 }),
      (error) =>
        error instanceof DomainError &&
        error.code === "NOT_FOUND" &&
        /has no version 99/.test(error.message)
    );
  });

  it("passes initialState through to the run", async () => {
    const sharedSchema = schema();
    const version = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [node({ id: "a", type: "inc" })] }),
      stateSchema: sharedSchema,
    });
    const { engine, pipeline } = setup([version]);
    const execution = await engine.run({
      pipelineId: pipeline.id,
      initialState: new State({ schema: sharedSchema, value: { counter: 41 } }),
    });
    assert.strictEqual(execution.status, "succeeded");
    const finalState = execution.run.result?.finalState as State | undefined;
    assert.strictEqual(finalState?.value.counter, 42);
  });

  it("honors an explicit run id", async () => {
    const { engine, pipeline } = setup([makeVersion(1, node({ id: "a", type: "inc" }))]);
    const execution = await engine.run({ pipelineId: pipeline.id, id: "custom-run" });
    assert.strictEqual(execution.id, "custom-run");
  });

  it("starts a run without waiting when using start()", async () => {
    const { engine, runtime, pipeline } = setup([makeVersion(1, node({ id: "a", type: "inc" }))]);
    const runId = engine.start({ pipelineId: pipeline.id });
    assert.ok(runId.startsWith("run-"));
    await waitUntil(runtime, runId);
    assert.strictEqual(runtime.status(runId).status, "succeeded");
  });

  it("keeps the registry authoritative: late registrations are seen", async () => {
    const registry = new PipelineRegistry();
    const runtime = new Runtime({ executor: new Executor({ actions: [incAction("inc")] }) });
    const engine = new PipelineEngine(registry, runtime);

    await assert.rejects(
      engine.run({ pipelineId: "late" }),
      (error) => error instanceof DomainError && error.code === "NOT_FOUND"
    );
    registry.register(new Pipeline({ id: "late", name: "Late", versions: [makeVersion(1, node({ id: "a", type: "inc" }))] }));
    const execution = await engine.run({ pipelineId: "late" });
    assert.strictEqual(execution.status, "succeeded");
  });

  it("delegates cancellation to the runtime unchanged", async () => {
    const registry = new PipelineRegistry();
    const pipeline = new Pipeline({ id: "cancel", name: "Cancel", versions: [makeVersion(1, node({ id: "a", type: "slow" }))] });
    registry.register(pipeline);
    const runtime = new Runtime({ executor: new Executor({ actions: [slowAction("slow")] }), eventBus: new EventBus() });
    const engine = new PipelineEngine(registry, runtime);

    const runId = engine.start({ pipelineId: pipeline.id, id: "cancel-run" });
    runtime.cancel("cancel-run");
    await waitUntil(runtime, runId);
    const info = runtime.status(runId);
    assert.strictEqual(info.status, "cancelled");
    assert.strictEqual(info.nodes[0]?.status, "cancelled");
  });
});

describe("DevHarness pipeline engine integration", () => {
  it("routes runPipeline through the PipelineEngine", async () => {
    const harness = new DevHarness();
    assert.ok(harness.getPipelineEngine() instanceof PipelineEngine);

    const runId = harness.runPipeline("dev.example");
    const runtime = harness.getRuntime();
    await waitUntil(runtime, runId);
    const info = runtime.status(runId);
    assert.strictEqual(info.status, "succeeded");
    assert.strictEqual(info.pipelineId, "dev.example");
    assert.strictEqual(info.pipelineVersion, 1);
    assert.strictEqual(info.nodes.length, 3);
  });
});