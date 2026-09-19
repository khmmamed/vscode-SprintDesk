import * as assert from "assert";
import {
  ArtifactService,
  CapabilityService,
  Platform,
  PlatformError,
  ResourceService,
  parsePipelineJson,
  pipelineToDefinition,
  stringifyPipelineDefinition,
} from "../../src/platform/index.js";
import { Graph, Node, PipelineVersion, StateSchema } from "../../src/kernel/index.js";
import { MemoryArtifactStore } from "../../src/runtime/index.js";

function version(number: number): PipelineVersion {
  return new PipelineVersion({
    version: number,
    graph: new Graph(),
    stateSchema: new StateSchema({ name: "platform-test" }),
  });
}

describe("Platform Foundation", () => {
  it("creates, validates, publishes, and executes only published versions", async () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "pipeline-1", name: "Pipeline 1" });
    platform.pipelineService.createVersion("pipeline-1", version(1));

    assert.strictEqual(platform.pipelineService.lifecycle("pipeline-1", 1), "draft");
    await assert.rejects(
      () => platform.runService.run({ pipelineId: "pipeline-1" }),
      (error: unknown) => error instanceof PlatformError && error.code === "VERSION_NOT_PUBLISHED"
    );

    platform.pipelineService.validate("pipeline-1", 1);
    assert.strictEqual(platform.pipelineService.lifecycle("pipeline-1", 1), "validated");
    platform.pipelineService.publish("pipeline-1", 1);
    const run = await platform.runService.run({ pipelineId: "pipeline-1", id: "platform-run-1" });

    assert.strictEqual(run.id, "platform-run-1");
    assert.strictEqual(run.pipeline.id, "pipeline-1");
    assert.strictEqual(run.pipeline.version, 1);
    assert.strictEqual(run.status, "succeeded");
    assert.deepStrictEqual(run.nodes, []);

    const control = platform.runControlService.get(run.id);
    assert.strictEqual(control.pipeline.name, "Pipeline 1");
    assert.strictEqual(control.durationMs !== undefined, true);
    assert.deepStrictEqual(platform.runControlService.list({ query: "pipeline-1" }).map((entry) => entry.id), [run.id]);
    assert.deepStrictEqual(platform.runControlService.historical().map((entry) => entry.id), [run.id]);
  });

  it("keeps published versions immutable and resolves the latest version", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "pipeline-2", name: "Pipeline 2" });
    platform.pipelineService.createVersion("pipeline-2", version(1));
    platform.pipelineService.validate("pipeline-2", 1);
    platform.pipelineService.publish("pipeline-2", 1);
    platform.pipelineService.createVersion("pipeline-2", version(2));

    assert.strictEqual(platform.pipelineService.latestVersion("pipeline-2").version, 2);
    assert.throws(
      () => platform.pipelineService.createVersion("pipeline-2", version(1)),
      (error: unknown) => error instanceof PlatformError && error.code === "INVALID_PLATFORM_OPERATION"
    );
    assert.strictEqual(platform.pipelineService.getVersionInfo("pipeline-2", 1).lifecycle, "published");
  });

  it("authors draft nodes, edges, schemas, metadata, and immutable versions", () => {
    const platform = new Platform();
    platform.authoringService.createPipeline({ id: "authoring", name: "Authoring" });
    platform.authoringService.createVersion("authoring", version(1));
    platform.authoringService.addNode("authoring", 1, { id: "fetch", type: "dev.log" });
    platform.authoringService.addNode("authoring", 1, { id: "save", type: "dev.log" });
    platform.authoringService.addEdge("authoring", 1, { from: "fetch", to: "save" });
    platform.authoringService.editStateSchema("authoring", 1, {
      name: "authoring-state",
      fields: { value: { type: "string", required: false } },
    });
    platform.authoringService.updatePipelineMetadata("authoring", { name: "Authored Pipeline", metadata: { owner: "test" } });

    const draft = platform.pipelineService.getVersion("authoring", 1);
    assert.deepStrictEqual([...draft.graph.nodes.keys()], ["fetch", "save"]);
    assert.deepStrictEqual(draft.graph.edges.map((edge) => [edge.from, edge.to]), [["fetch", "save"]]);
    assert.strictEqual(draft.stateSchema.name, "authoring-state");
    assert.strictEqual(platform.pipelineService.get("authoring").name, "Authored Pipeline");

    platform.pipelineService.validate("authoring", 1);
    platform.pipelineService.publish("authoring", 1);
    assert.throws(
      () => platform.authoringService.replaceNode("authoring", 1, { id: "fetch", type: "changed" }),
      (error: unknown) => error instanceof PlatformError && error.code === "INVALID_PLATFORM_OPERATION"
    );

    const cloned = platform.authoringService.cloneVersion("authoring", 1, 2);
    assert.strictEqual(cloned.version, 2);
    assert.strictEqual(platform.pipelineService.lifecycle("authoring", 1), "published");
    assert.strictEqual(platform.pipelineService.lifecycle("authoring", 2), "draft");
  });

  it("round-trips the canonical pipeline definition through JSON", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "ir", name: "IR" });
    platform.pipelineService.createVersion("ir", new PipelineVersion({
      version: 1,
      graph: new Graph({ nodes: [new Node({ id: "one", type: "dev.log" })], edges: [] }),
      stateSchema: new StateSchema({ name: "ir-state" }),
    }));
    const pipeline = platform.pipelineService.get("ir");
    const json = stringifyPipelineDefinition(pipelineToDefinition(pipeline));
    const parsed = parsePipelineJson(json);

    assert.deepStrictEqual(parsed, pipelineToDefinition(pipeline));
  });

  it("wraps scheduler lifecycle without implementing scheduling", async () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "pipeline-3", name: "Pipeline 3" });
    platform.pipelineService.createVersion("pipeline-3", version(1));
    platform.pipelineService.validate("pipeline-3", 1);
    platform.pipelineService.publish("pipeline-3", 1);

    const schedule = platform.scheduleService.create({ id: "schedule-1", pipelineId: "pipeline-3", trigger: { type: "manual" } });
    assert.strictEqual(schedule.enabled, true);
    assert.strictEqual(platform.scheduleService.disable(schedule.id).enabled, false);
    assert.strictEqual(platform.scheduleService.enable(schedule.id).enabled, true);
    platform.scheduleService.trigger(schedule.id);

    for (
      let attempt = 0;
      attempt < 20 && (platform.runService.list()[0]?.status === "queued" || platform.runService.list().length === 0);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(platform.runService.list()[0]?.status, "succeeded");
  });

  it("exposes capabilities, resources, and artifacts through stable facades", () => {
    const capabilities = new CapabilityService();
    assert.deepStrictEqual(
      capabilities.register({ id: "cap-1", type: "test", version: 1, metadata: { label: "Test" } }),
      { id: "cap-1", type: "test", version: 1, metadata: { label: "Test" } }
    );
    assert.strictEqual(capabilities.get("cap-1").metadata.label, "Test");
    assert.strictEqual(capabilities.remove("cap-1"), true);

    const resources = new ResourceService();
    resources.register({ id: "resource-1", type: "memory", version: "1", metadata: { scope: "test" } });
    assert.strictEqual(resources.list()[0]?.id, "resource-1");

    const artifacts = new ArtifactService(new MemoryArtifactStore());
    artifacts.store.save({ id: "artifact-1", type: "result", name: "Result", ref: { kind: "content", content: 1 } });
    assert.strictEqual(artifacts.get("artifact-1")?.name, "Result");
    artifacts.delete("artifact-1");
    assert.strictEqual(artifacts.get("artifact-1"), null);
  });

  it("catalogs resource versions without replacing runtime resolution until activation", () => {
    const platform = new Platform();
    const schema = { name: "resource-config", fields: { endpoint: { type: "string" as const, required: true } } };
    platform.resourceService.register({ id: "resource-catalog", type: "http", version: "1" }, {
      configurationSchema: schema,
      availability: "available",
      documentation: "https://example.invalid/resource",
    });
    platform.resourceService.registerVersion({ id: "resource-catalog", type: "http", version: "2" }, {
      activate: false,
      availability: "unknown",
    });

    assert.strictEqual(platform.resourceService.get("resource-catalog").version, "1");
    assert.strictEqual(platform.resourceService.listVersions("resource-catalog").length, 2);
    assert.deepStrictEqual(platform.resourceService.get("resource-catalog", "1").configurationSchema, schema);
    assert.strictEqual(platform.resourceService.get("resource-catalog", "1").availability, "available");
    assert.strictEqual(platform.resourceService.validate("resource-catalog", "1").valid, true);
    assert.strictEqual(platform.resourceService.activate("resource-catalog", "2").version, "2");
    assert.strictEqual(platform.resourceService.get("resource-catalog").version, "2");
  });

  it("reports resource usage from pipeline references", () => {
    const platform = new Platform();
    platform.resourceService.register({ id: "resource-used", type: "memory", version: "1" });
    platform.pipelineService.create({ id: "resource-user", name: "Resource User" });
    platform.pipelineService.createVersion("resource-user", new PipelineVersion({
      version: 1,
      graph: new Graph({
        nodes: [new Node({ id: "uses-resource", type: "dev.log", resourceReferences: [{ resourceId: "resource-used" }] })],
        edges: [],
      }),
      stateSchema: new StateSchema({ name: "resource-user-state" }),
    }));

    const usage = platform.resourceService.usage("resource-used", platform.pipelineService.list());
    assert.deepStrictEqual(usage.map((entry) => ({ pipelineId: entry.pipelineId, nodeId: entry.nodeId })), [
      { pipelineId: "resource-user", nodeId: "uses-resource" },
    ]);
  });
});
