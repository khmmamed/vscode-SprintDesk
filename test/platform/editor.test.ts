import * as assert from "assert";
import { Graph, PipelineVersion, StateSchema } from "../../src/kernel/index.js";
import { Platform, PlatformError } from "../../src/platform/index.js";

function emptyVersion(version: number): PipelineVersion {
  return new PipelineVersion({
    version,
    graph: new Graph(),
    stateSchema: new StateSchema({ name: "editor" }),
  });
}

describe("Pipeline editor", () => {
  it("projects and edits a draft with undo and redo", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "editor-draft", name: "Editor Draft" });
    platform.pipelineService.createVersion("editor-draft", emptyVersion(1));
    const session = platform.openPipelineEditor("editor-draft", 1);

    session.state.addNode({ id: "fetch", type: "http" });
    session.state.addNode({ id: "save", type: "file" });
    session.state.addEdge("fetch", "save");
    assert.strictEqual(session.state.snapshot().nodes.length, 2);
    assert.strictEqual(session.state.snapshot().edges.length, 1);
    assert.strictEqual(session.state.undo(), true);
    assert.strictEqual(session.state.snapshot().edges.length, 0);
    assert.strictEqual(session.state.redo(), true);
    assert.strictEqual(session.state.snapshot().edges.length, 1);

    session.save();
    assert.strictEqual(platform.pipelineService.getVersion("editor-draft", 1).graph.nodes.size, 2);
    assert.strictEqual(session.state.snapshot().dirty, false);
  });

  it("creates a new draft when editing a published version", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "editor-published", name: "Editor Published" });
    platform.pipelineService.createVersion("editor-published", emptyVersion(1));
    platform.pipelineService.validate("editor-published", 1);
    platform.pipelineService.publish("editor-published", 1);
    const session = platform.openPipelineEditor("editor-published", 1);

    session.state.addNode({ id: "new-node", type: "transform" });
    const saved = session.save();

    assert.strictEqual(saved.version, 2);
    assert.strictEqual(platform.pipelineService.lifecycle("editor-published", 1), "published");
    assert.strictEqual(platform.pipelineService.lifecycle("editor-published", 2), "draft");
    assert.strictEqual(platform.pipelineService.getVersion("editor-published", 1).graph.nodes.size, 0);
    assert.strictEqual(platform.pipelineService.getVersion("editor-published", 2).graph.nodes.size, 1);
  });

  it("publishes only after validation", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "editor-lifecycle", name: "Editor Lifecycle" });
    platform.pipelineService.createVersion("editor-lifecycle", emptyVersion(1));
    const session = platform.openPipelineEditor("editor-lifecycle", 1);

    assert.strictEqual(session.lifecycle, "draft");
    assert.throws(
      () => platform.pipelineService.publish("editor-lifecycle", 1),
      (error: unknown) => error instanceof PlatformError && error.code === "INVALID_PLATFORM_OPERATION"
    );
    session.publish();
    assert.strictEqual(session.lifecycle, "published");
  });
});