import * as assert from "assert";
import { Graph, Node, PipelineVersion, StateSchema } from "../../src/kernel/index.js";
import { ArtifactService } from "../../src/platform/index.js";
import { Executor, MemoryArtifactStore, type NodeAction } from "../../src/runtime/index.js";

describe("Artifact Platform", () => {
  it("exposes lineage from the real executor commit", async () => {
    const store = new MemoryArtifactStore();
    const action: NodeAction = {
      type: "emit-artifact",
      run: ({ state, artifacts }) => {
        artifacts.emit({
          id: "artifact-lineage",
          type: "report",
          name: "Lineage Report",
          ref: { kind: "content", content: { ok: true } },
        });
        return state;
      },
    };
    const version = new PipelineVersion({
      version: 3,
      graph: new Graph({ nodes: [new Node({ id: "produce", type: "emit-artifact" })], edges: [] }),
      stateSchema: new StateSchema({ name: "artifact-platform" }),
    });
    await new Executor({ actions: [action], artifactStore: store }).execute(version, {
      id: "artifact-execution",
      pipelineId: "artifact-pipeline",
      pipelineVersion: 3,
    });

    const artifacts = new ArtifactService(store);
    const artifact = artifacts.get("artifact-lineage");
    assert.ok(artifact);
    assert.deepStrictEqual(artifact.lineage, {
      executionId: "artifact-execution",
      pipelineId: "artifact-pipeline",
      pipelineVersion: 3,
      nodeId: "produce",
      attempt: 1,
    });
    assert.strictEqual(artifacts.byExecution("artifact-execution").length, 1);
    assert.strictEqual(artifacts.byNode("artifact-execution", "produce").length, 1);
    assert.deepStrictEqual(artifacts.inspect("artifact-lineage")?.reference, artifact.ref);
    assert.strictEqual(artifacts.setRetention("artifact-lineage", { policy: "retain" })?.retention?.policy, "retain");
    artifacts.delete("artifact-lineage");
    assert.strictEqual(artifacts.get("artifact-lineage"), null);
  });
});