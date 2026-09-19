import * as assert from "assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DomainError,
  Graph,
  Node,
  Pipeline,
  PipelineRegistry,
  PipelineVersion,
  StateSchema,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  FilePipelineStore,
  MemoryPipelineStore,
  Schedule,
  fromStoredPipeline,
  fromStoredSchedule,
  toStoredPipeline,
  toStoredSchedule,
  fromStoredPipelineVersion,
  toStoredPipelineVersion,
  type StoredPipeline,
} from "../../src/runtime/index.js";
import { parseStoredPipeline } from "../../src/runtime/persistence/PipelineStore.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "pipeline-registry", fields });
}

function versionOf(version: number, nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema({ handled: { type: "string", required: false } }),
  });
}

function examplePipeline(): Pipeline {
  return new Pipeline({
    id: "example.capable",
    name: "Example Capable Pipeline",
    versions: [
      versionOf(1, [
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "example.capability",
          resourceReferences: [{ resourceId: "database-main" }, { resourceId: "api-main" }],
        }),
      ]),
    ],
    metadata: { owner: "dev" },
  });
}

function throughJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("kernel PipelineRegistry", () => {
  it("registers, gets, lists, has, and removes definition instances", () => {
    const registry = new PipelineRegistry();
    const pipeline = examplePipeline();

    registry.register(pipeline);
    assert.strictEqual(registry.has("example.capable"), true);
    assert.strictEqual(registry.get("example.capable").id, "example.capable");
    assert.strictEqual(registry.list().length, 1);
    assert.strictEqual(registry.remove("example.capable"), true);
    assert.strictEqual(registry.remove("example.capable"), false);
    assert.strictEqual(registry.list().length, 0);
  });

  it("rejects a duplicate registration", () => {
    const registry = new PipelineRegistry();
    registry.register(examplePipeline());
    assert.throws(
      () => registry.register(examplePipeline()),
      (error) => error instanceof DomainError && error.code === "DUPLICATE_ID"
    );
  });

  it("reports NOT_FOUND for a missing pipeline", () => {
    const registry = new PipelineRegistry();
    assert.throws(
      () => registry.get("nope"),
      (error) => error instanceof DomainError && error.code === "NOT_FOUND"
    );
  });
});

describe("pipeline persistence completeness", () => {
  it("serializes a canonical definition without runtime objects", () => {
    const stored = toStoredPipeline(examplePipeline());
    assert.strictEqual(stored.id, "example.capable");
    assert.strictEqual(stored.name, "Example Capable Pipeline");
    assert.deepStrictEqual(stored.metadata, { owner: "dev" });
    assert.strictEqual(stored.versions.length, 1);

    const node = stored.versions[0].graph.nodes[0];
    assert.deepStrictEqual(Object.keys(node).sort(), ["capabilityId", "id", "metadata", "resourceReferences", "type", "version"]);
    assert.deepStrictEqual(node.resourceReferences, [{ resourceId: "database-main" }, { resourceId: "api-main" }]);
    assert.strictEqual(node.capabilityId, "example.capability");

    const json = JSON.stringify(stored).toLowerCase();
    for (const forbidden of ["handler", "resolver", "executor", "runtime", "abortcontroller", "signaling", "eventbus"]) {
      assert.ok(!json.includes(forbidden), `persisted pipeline must not contain "${forbidden}"`);
    }
  });

  it("round-trips a Pipeline definition through JSON losslessly", () => {
    const pipeline = examplePipeline();
    const stored = throughJson(toStoredPipeline(pipeline));
    const parsed = parseStoredPipeline(stored);
    const hydrated = fromStoredPipeline(parsed);

    assert.strictEqual(hydrated.id, pipeline.id);
    assert.strictEqual(hydrated.name, pipeline.name);
    assert.deepStrictEqual(hydrated.metadata, pipeline.metadata);
    assert.strictEqual(hydrated.versions.length, pipeline.versions.length);

    const original = pipeline.latestVersion();
    const restored = hydrated.latestVersion();
    assert.ok(original && restored);
    assert.strictEqual(restored.version, original.version);
    assert.strictEqual(restored.stateSchema.name, original.stateSchema.name);
    assert.strictEqual(restored.graph.nodeCount, original.graph.nodeCount);
    assert.strictEqual(restored.graph.edgeCount, original.graph.edgeCount);
    assert.deepStrictEqual(restored.graph.edges, original.graph.edges);

    const node = restored.graph.nodes.get("a");
    assert.strictEqual(node?.capabilityId, "example.capability");
    assert.deepStrictEqual(node?.resourceReferences, [{ resourceId: "database-main" }, { resourceId: "api-main" }]);
  });

  it("hydrates a legacy stored pipeline that omits metadata", () => {
    const stored = throughJson(toStoredPipeline(examplePipeline())) as StoredPipeline;
    delete (stored as { metadata?: unknown }).metadata;

    const hydrated = fromStoredPipeline(stored);
    assert.strictEqual(hydrated.id, "example.capable");
    assert.deepStrictEqual(hydrated.metadata, {});
    assert.strictEqual(hydrated.versions.length, 1);
  });

  it("rejects malformed stored pipelines at the definition boundary", () => {
    assert.throws(() => parseStoredPipeline({ id: " ", name: "x", versions: [] }), /Malformed persisted pipeline data/);
    assert.throws(() => parseStoredPipeline({ id: "x", name: 5, versions: [] }), /Malformed persisted pipeline data/);
    assert.throws(() => parseStoredPipeline({ id: "x", name: "x", versions: "nope" }), /Malformed persisted pipeline data/);

    const cyclic = {
      id: "x",
      name: "x",
      versions: [
        {
          version: 1,
          graph: {
            nodes: [
              { id: "a", type: "primitive" },
              { id: "b", type: "primitive" },
            ],
            edges: [
              { from: "a", to: "b" },
              { from: "b", to: "a" },
            ],
          },
          stateSchema: { name: "s", fields: {} },
        },
      ],
    };
    assert.throws(() => parseStoredPipeline(cyclic), /Malformed persisted pipeline data/);

    const duplicateVersions = {
      id: "x",
      name: "x",
      versions: [
        {
          version: 1,
          graph: { nodes: [{ id: "a", type: "primitive" }], edges: [] },
          stateSchema: { name: "s", fields: {} },
        },
        {
          version: 1,
          graph: { nodes: [{ id: "a", type: "primitive" }], edges: [] },
          stateSchema: { name: "s", fields: {} },
        },
      ],
    };
    assert.throws(() => parseStoredPipeline(duplicateVersions), /Malformed persisted pipeline data/);
  });

  it("version-serializes independently for reuse by pipelines and schedules", () => {
    const version = versionOf(2, [
      new Node({ id: "a", type: "primitive", capabilityId: "cap.x", resourceReferences: [{ resourceId: "r" }] }),
    ]);
    const restored = fromStoredPipelineVersion(throughJson(toStoredPipelineVersion(version)));
    assert.strictEqual(restored.version, 2);
    assert.strictEqual(restored.graph.nodes.get("a")?.capabilityId, "cap.x");
    assert.deepStrictEqual(restored.graph.nodes.get("a")?.resourceReferences, [{ resourceId: "r" }]);
  });

  it("persists and reloads a pipeline through a MemoryPipelineStore", () => {
    const store = new MemoryPipelineStore();
    store.save(toStoredPipeline(examplePipeline()));
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.get("example.capable")?.name, "Example Capable Pipeline");
    assert.strictEqual(store.get("nope"), null);

    store.delete("example.capable");
    assert.strictEqual(store.list().length, 0);
  });

  it("persists and reloads a pipeline across a FilePipelineStore restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprintdesk-pipelines-"));
    try {
      const filePath = join(dir, "pipelines.json");
      const first = new FilePipelineStore({ filePath });
      first.save(toStoredPipeline(examplePipeline()));

      const second = new FilePipelineStore({ filePath });
      assert.strictEqual(second.list().length, 1);
      const restored = fromStoredPipeline(second.get("example.capable") as StoredPipeline);
      assert.strictEqual(restored.name, "Example Capable Pipeline");
      assert.strictEqual(restored.latestVersion()?.graph.nodes.get("a")?.capabilityId, "example.capability");

      second.delete("example.capable");
      const third = new FilePipelineStore({ filePath });
      assert.strictEqual(third.list().length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a malformed pipeline store file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprintdesk-pipelines-"));
    try {
      const filePath = join(dir, "pipelines.json");
      writeFileSync(filePath, JSON.stringify({ version: 1, pipelines: [{ id: "broken" }] }), "utf8");
      assert.throws(
        () => new FilePipelineStore({ filePath }),
        (error: unknown) => {
          assert.ok(error instanceof DomainError);
          assert.ok((error as DomainError).message.includes("Malformed pipeline store file"));
          return true;
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schedules a pipeline reference through the schedule persistence boundary", () => {
    const pipeline = fromStoredPipeline(throughJson(toStoredPipeline(examplePipeline())));
    const version = pipeline.latestVersion() as PipelineVersion;
    const schedule = new Schedule({ id: "from-pipeline", pipelineId: pipeline.id, version: version?.version });

    const stored = throughJson(toStoredSchedule(schedule));
    const restored = fromStoredSchedule(stored);

    assert.strictEqual(restored.id, "from-pipeline");
    assert.strictEqual(restored.pipelineId, "example.capable");
    assert.strictEqual(restored.version, 1);
  });
});

describe("pipeline definition validation", () => {
  it("rejects duplicate versions within a Pipeline", () => {
    assert.throws(
      () =>
        new Pipeline({
          id: "dup",
          name: "Dup",
          versions: [
            versionOf(1, [new Node({ id: "a", type: "primitive" })]),
            versionOf(1, [new Node({ id: "a", type: "primitive" })]),
          ],
        }),
      (error) => error instanceof DomainError && error.code === "DUPLICATE_ID"
    );
  });

  it("rejects graph cycles, orphan edges, and duplicate node ids", () => {
    assert.throws(
      () =>
        new Graph({
          nodes: [new Node({ id: "a", type: "p" }), new Node({ id: "b", type: "p" })],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        }),
      (error) => error instanceof DomainError && error.message.includes("CYCLE")
    );
    assert.throws(
      () =>
        new Graph({
          nodes: [new Node({ id: "a", type: "p" })],
          edges: [{ from: "a", to: "missing" }],
        }),
      (error) => error instanceof DomainError && error.message.includes("UNRESOLVED_REFERENCE")
    );
    assert.throws(
      () => new Graph({ nodes: [new Node({ id: "a", type: "p" }), new Node({ id: "a", type: "q" })] }),
      (error) => error instanceof DomainError && error.message.includes("DUPLICATE_ID")
    );
  });

  it("exposes latestVersion and preserves version identity", () => {
    const pipeline = new Pipeline({
      id: "versions",
      name: "Versions",
      versions: [
        versionOf(1, [new Node({ id: "a", type: "primitive" })]),
        versionOf(2, [new Node({ id: "a", type: "primitive" }), new Node({ id: "b", type: "primitive" })], [["a", "b"]]),
      ],
    });
    assert.strictEqual(pipeline.latestVersion()?.version, 2);
    assert.deepStrictEqual(pipeline.versions.map((v) => v.version), [1, 2]);
  });
});