import * as assert from "assert";
import {
  Capability,
  CapabilityHandlerRegistry,
  CapabilityRegistry,
  Graph,
  Node,
  Pipeline,
  PipelineVersion,
  Resource,
  ResourceRegistry,
  State,
  StateSchema,
  type CapabilityHandler,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  Executor,
  MemoryScheduleStore,
  RegistryResourceResolver,
  Schedule,
  fromStoredPipeline,
  fromStoredPipelineVersion,
  fromStoredSchedule,
  toStoredPipelineVersion,
  toStoredSchedule,
  type CapabilityExecutionContext,
  type CapabilityNodeInput,
  type StoredSchedule,
} from "../../src/runtime/index.js";
import { parseStoredPipeline } from "../../src/runtime/persistence/PipelineStore.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "persistence-completeness", fields });
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema({ handled: { type: "string", required: false } }),
  });
}

function throughJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function registriesFor(
  capabilityId: string,
  handler?: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>
): {
  readonly capabilities: CapabilityRegistry;
  readonly handlers: CapabilityHandlerRegistry;
} {
  const capabilities = new CapabilityRegistry();
  capabilities.register(new Capability({ id: capabilityId, type: "capability", version: 1 }));
  const handlers = new CapabilityHandlerRegistry();
  if (handler) {
    handlers.register(handler);
  }
  return { capabilities, handlers };
}

describe("pipeline persistence completeness", () => {
  it("persists Node.capabilityId across a serialize → JSON → deserialize round trip", () => {
    const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "example.capability" })]);
    const stored = toStoredPipelineVersion(version);
    assert.strictEqual(stored.graph.nodes[0].capabilityId, "example.capability");

    const hydrated = fromStoredPipelineVersion(throughJson(stored));
    assert.strictEqual(hydrated.graph.nodes.get("a")?.capabilityId, "example.capability");
  });

  it("persists multiple resource references in their original order", () => {
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        resourceReferences: [{ resourceId: "database-main" }, { resourceId: "api-main" }],
      }),
    ]);
    const stored = toStoredPipelineVersion(version);
    assert.deepStrictEqual(stored.graph.nodes[0].resourceReferences, [
      { resourceId: "database-main" },
      { resourceId: "api-main" },
    ]);

    const hydrated = fromStoredPipelineVersion(throughJson(stored));
    assert.deepStrictEqual(hydrated.graph.nodes.get("a")?.resourceReferences, [
      { resourceId: "database-main" },
      { resourceId: "api-main" },
    ]);
  });

  it("keeps an explicit empty resourceReferences list valid", () => {
    const version = versionOf([new Node({ id: "a", type: "primitive", resourceReferences: [] })]);
    const hydrated = fromStoredPipelineVersion(throughJson(toStoredPipelineVersion(version)));
    assert.deepStrictEqual(hydrated.graph.nodes.get("a")?.resourceReferences, []);
    assert.deepStrictEqual(hydrated.graph.nodes.get("a")?.capabilityId, undefined);
  });

  it("hydrates a legacy node without capability/resource fields to its defaults", () => {
    const legacy = {
      id: "legacy",
      name: "Legacy",
      versions: [
        {
          version: 1,
          stateSchema: { name: "s", fields: {} },
          graph: {
            nodes: [{ id: "a", type: "counter" }],
            edges: [],
          },
        },
      ],
    };

    const pipeline = fromStoredPipeline(parseStoredPipeline(legacy));
    const version = pipeline.latestVersion() as PipelineVersion;
    const node = version.graph.nodes.get("a");
    assert.strictEqual(node?.id, "a");
    assert.strictEqual(node?.type, "counter");
    assert.strictEqual(node?.capabilityId, undefined);
    assert.deepStrictEqual(node?.resourceReferences, []);
    assert.strictEqual(version.graph.nodeCount, 1);
  });

  it("rejects a persisted capabilityId that is not a string", () => {
    const bad = {
      id: "bad",
      name: "Bad",
      versions: [
        {
          version: 1,
          stateSchema: { name: "s", fields: {} },
          graph: {
            nodes: [{ id: "a", type: "primitive", capabilityId: 5 }],
            edges: [],
          },
        },
      ],
    };

    assert.throws(() => parseStoredPipeline(bad), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes("Malformed persisted pipeline data"));
      return true;
    });
  });

  it("retains its pipeline reference through the full schedule-store restart path", () => {
    const schedule = new Schedule({ id: "scheduled-ref", pipelineId: "p", version: 1 });

    const firstStore = new MemoryScheduleStore();
    firstStore.save(throughJson(toStoredSchedule(schedule)));

    const secondStore = new MemoryScheduleStore();
    secondStore.save(throughJson(firstStore.get("scheduled-ref") as StoredSchedule));

    const restored = fromStoredSchedule(secondStore.get("scheduled-ref") as StoredSchedule);
    assert.strictEqual(restored.pipelineId, "p");
    assert.strictEqual(restored.version, 1);
    assert.strictEqual(restored.enabled, true);
  });

  it("a capability node keeps its resolved resources after hydration and execution", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "example.capability",
      run: async (input) => {
        captured = input.resources;
        return input.state.withValue("handled", "yes");
      },
    };
    const { capabilities, handlers } = registriesFor("example.capability", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(new Resource({ id: "database-main", type: "database", version: "1", metadata: { kind: "postgres" } }));
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: new RegistryResourceResolver(resourceRegistry),
    });

    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "example.capability",
        resourceReferences: [{ resourceId: "database-main" }],
      }),
    ]);
    const hydrated = fromStoredPipelineVersion(throughJson(toStoredPipelineVersion(version)));

    const execution = await executor.execute(hydrated, { id: "exec-after-restart" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.strictEqual(captured["database-main"].id, "database-main");
    assert.strictEqual(captured["database-main"].type, "database");
    assert.strictEqual((captured["database-main"].metadata as { kind: string }).kind, "postgres");
    assert.strictEqual((execution.run.result?.finalState as State).get("handled"), "yes");
  });

  it("a legacy pipeline without capability or resource fields still executes as before", async () => {
    let ran = false;
    const executor = new Executor({
      actions: [
        {
          type: "counter",
          run: ({ state }) => {
            ran = true;
            return state.withValue("handled", "legacy-ok");
          },
        },
      ],
    });
    const legacy = {
      id: "legacy-run",
      name: "Legacy Run",
      versions: [
        {
          version: 1,
          stateSchema: { name: "s", fields: {} },
          graph: {
            nodes: [{ id: "a", type: "counter" }],
            edges: [],
          },
        },
      ],
    };

    const pipeline = fromStoredPipeline(parseStoredPipeline(legacy));
    const execution = await executor.execute(pipeline.latestVersion() as PipelineVersion, { id: "legacy-after-restart" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(ran, true);
    assert.strictEqual((execution.run.result?.finalState as State).get("handled"), "legacy-ok");
  });
});