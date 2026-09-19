import * as assert from "assert";
import { Graph, Node, Pipeline, PipelineVersion, StateSchema } from "../../src/kernel/index.js";

describe("kernel/pipeline", () => {
  function version(versionNumber: number, edgeFrom: string, edgeTo: string): PipelineVersion {
    return new PipelineVersion({
      version: versionNumber,
      graph: new Graph({
        nodes: [new Node({ id: "source", type: "t" }), new Node({ id: "sink", type: "t" })],
        edges: [{ from: edgeFrom, to: edgeTo }],
      }),
      stateSchema: new StateSchema({ name: "task" }),
    });
  }

  it("creates a frozen, versioned pipeline", () => {
    const pipeline = new Pipeline({
      id: "release",
      name: "Release",
      versions: [version(1, "source", "sink")],
    });
    assert.strictEqual(pipeline.id, "release");
    assert.strictEqual(pipeline.name, "Release");
    assert.strictEqual(pipeline.versions.length, 1);
    assert.ok(Object.isFrozen(pipeline));
  });

  it("links Pipeline -> PipelineVersion -> Graph -> Node/Edge", () => {
    const pipelineVersion = version(1, "source", "sink");
    const pipeline = new Pipeline({ id: "p", name: "P", versions: [pipelineVersion] });
    const graph = pipeline.latestVersion()!.graph;
    assert.ok(graph.hasNode("source"));
    assert.strictEqual(graph.edgeCount, 1);
  });

  it("withVersion appends and latestVersion returns the highest version", () => {
    const pipeline = new Pipeline({ id: "p", name: "P", versions: [version(2, "source", "sink")] });
    const extended = pipeline.withVersion(version(3, "source", "sink"));
    assert.strictEqual(pipeline.versions.length, 1);
    assert.strictEqual(extended.versions.length, 2);
    assert.strictEqual(extended.latestVersion()!.version, 3);
  });

  it("rejects duplicate versions", () => {
    assert.throws(() => new Pipeline({ id: "p", name: "P", versions: [version(1, "source", "sink"), version(1, "source", "sink")] }));
  });

  it("rejects invalid version numbers", () => {
    assert.throws(() =>
      new PipelineVersion({
        version: 0,
        graph: new Graph({ nodes: [new Node({ id: "n", type: "t" })] }),
        stateSchema: new StateSchema({ name: "s" }),
      })
    );
  });

  it("latestVersion is undefined when the pipeline has no versions", () => {
    const pipeline = new Pipeline({ id: "p", name: "P" });
    assert.strictEqual(pipeline.latestVersion(), undefined);
  });
});