import * as assert from "assert";
import { EventBus, Graph, Node, PipelineVersion, StateSchema } from "../../src/kernel/index.js";
import { DebuggingService, Platform } from "../../src/platform/index.js";
import { Executor, Runtime, type NodeAction } from "../../src/runtime/index.js";

describe("Debugging Platform", () => {
  it("reconstructs timeline, state snapshots, and node history from runtime data", async () => {
    const eventBus = new EventBus();
    const action: NodeAction = {
      type: "increment",
      run: ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
    };
    const runtime = new Runtime({ executor: new Executor({ actions: [action] }), eventBus });
    const platform = new Platform({ runtime, eventBus });
    platform.pipelineService.create({ id: "debug-pipeline", name: "Debug Pipeline" });
    platform.pipelineService.createVersion("debug-pipeline", new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "increment", type: "increment" })], edges: [] }),
      stateSchema: new StateSchema({ name: "debug-state", fields: { count: { type: "number", required: false } } }),
    }));
    platform.pipelineService.validate("debug-pipeline", 1);
    platform.pipelineService.publish("debug-pipeline", 1);

    const run = await platform.runService.run({ pipelineId: "debug-pipeline", id: "debug-run" });
    const timeline = platform.debuggingService.timeline(run.id);

    assert.strictEqual(timeline.run.status, "succeeded");
    assert.ok(timeline.events.some((event) => event.type === "execution.node.finished"));
    assert.deepStrictEqual(platform.debuggingService.stateAfterNode(run.id, "increment"), { count: 1 });
    assert.strictEqual(timeline.states[0]?.version, 2);
    assert.strictEqual(platform.debuggingService.events(run.id, "execution.run.finished").length, 1);
    assert.strictEqual(platform.debuggingService.failureContext(run.id).error, undefined);
  });
});