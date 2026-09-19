import * as assert from "assert";
import { Execution, Graph, Node, Pipeline, PipelineRun, PipelineVersion, State, StateSchema } from "../../src/kernel/index.js";

describe("kernel/execution", () => {
  describe("PipelineRun status machine", () => {
    it("starts queued", () => {
      const run = new PipelineRun({ id: "r1" });
      assert.strictEqual(run.status, "queued");
      assert.ok(Object.isFrozen(run));
    });

    it("follows queued -> running -> succeeded", () => {
      let run = new PipelineRun({ id: "r1" });
      run = run.start(1000);
      assert.strictEqual(run.status, "running");
      assert.strictEqual(run.startedAt, 1000);
      run = run.succeed({ ok: true }, 2000);
      assert.strictEqual(run.status, "succeeded");
      assert.strictEqual(run.finishedAt, 2000);
      assert.deepStrictEqual(run.result, { ok: true });
    });

    it("allows queued -> cancelled", () => {
      const run = new PipelineRun({ id: "r1" }).cancel(500);
      assert.strictEqual(run.status, "cancelled");
      assert.strictEqual(run.finishedAt, 500);
    });

    it("rejects illegal transitions", () => {
      const queued = new PipelineRun({ id: "r1" });
      assert.throws(
        () => queued.succeed({}),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ILLEGAL_TRANSITION"
      );
      assert.throws(
        () => queued.fail("boom"),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ILLEGAL_TRANSITION"
      );

      const running = queued.start(0);
      assert.throws(() => running.start(0), /Cannot transition/);

      const succeeded = running.succeed({});
      assert.throws(() => succeeded.cancel(), /Cannot transition/);
      assert.throws(() => succeeded.start(), /Cannot transition/);
    });

    it("records an error on failure", () => {
      const run = new PipelineRun({ id: "r1" }).start(0).fail("boom");
      assert.strictEqual(run.status, "failed");
      assert.strictEqual(run.error, "boom");
    });

    it("transitions produce new instances (immutability)", () => {
      const queued = new PipelineRun({ id: "r1" });
      const running = queued.start(0);
      assert.notStrictEqual(running, queued);
      assert.strictEqual(queued.status, "queued");
    });
  });

  describe("Execution", () => {
    const schema = new StateSchema({ name: "task", fields: { count: { type: "number" } } });
    const state = new State({ schema, value: { count: 0 } });
    const pipelineVersion = new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "n", type: "t" })], edges: [] }),
      stateSchema: schema,
    });
    const pipeline = new Pipeline({ id: "p", name: "P", versions: [pipelineVersion] });

    it("creates a frozen execution bound to a pipeline version and initial state", () => {
      const execution = new Execution({ id: "x1", pipeline, version: pipelineVersion, initialState: state });
      assert.strictEqual(execution.status, "queued");
      assert.strictEqual(execution.pipeline?.id, "p");
      assert.strictEqual(execution.version.version, 1);
      assert.strictEqual(execution.initialState.get("count"), 0);
      assert.ok(Object.isFrozen(execution));
    });

    it("withRun advances the execution status", () => {
      const execution = new Execution({ id: "x1", pipeline, version: pipelineVersion, initialState: state });
      const running = execution.withRun(execution.run.start(0));
      assert.strictEqual(running.status, "running");
      assert.strictEqual(execution.status, "queued");
    });

    it("rejects empty id", () => {
      assert.throws(() => new Execution({ id: " ", pipeline, version: pipelineVersion, initialState: state }));
    });
  });
});