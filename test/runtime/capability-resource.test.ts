import * as assert from "assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Capability,
  CapabilityHandlerRegistry,
  CapabilityRegistry,
  DomainError,
  EventBus,
  Graph,
  Node,
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
  FileRunStore,
  MemoryArtifactStore,
  RegistryResourceResolver,
  Runtime,
  fromStoredPipelineVersion,
  toStoredPipelineVersion,
  type CapabilityExecutionContext,
  type CapabilityNodeInput,
  type NodeAction,
  type ResourceResolver,
} from "../../src/runtime/index.js";
import { parseStoredPipeline } from "../../src/runtime/persistence/PipelineStore.js";
import { parseStoredRun, toStoredNodeRun } from "../../src/runtime/persistence/RunStore.js";

const tempDirs: string[] = [];

function tmpdirPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sprintdesk-capability-resource-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "capability-resource", fields });
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema({
      name: { type: "string", required: false },
      count: { type: "number", required: false },
      handled: { type: "string", required: false },
    }),
  });
}

function registriesFor(
  capabilityId: string,
  handler?: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>,
  version = 1
): { readonly capabilities: CapabilityRegistry; readonly handlers: CapabilityHandlerRegistry } {
  const capabilities = new CapabilityRegistry();
  capabilities.register(new Capability({ id: capabilityId, type: "capability", version }));
  const handlers = new CapabilityHandlerRegistry();
  if (handler) {
    handlers.register(handler);
  }
  return { capabilities, handlers };
}

function resourceOf(id: string, version = "1", metadata: Readonly<Record<string, unknown>> = {}): Resource {
  return new Resource({ id, type: "test-resource", version, metadata });
}

function artifact(id: string, content: unknown = id): {
  id: string;
  type: string;
  name: string;
  ref: { kind: "content"; content: unknown };
} {
  return { id, type: "report", name: `artifact-${id}`, ref: { kind: "content", content } };
}

function plainCapabilityHandler(
  capabilityId: string,
  run: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>["run"]
): CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> {
  return { capabilityId, run };
}

describe("runtime 2.19 capability/resource completion", () => {
  describe("capability version lifecycle", () => {
    it("validates the capability version as a positive integer", () => {
      assert.throws(
        () => new Capability({ id: "cap.v", type: "capability", version: 0 }),
        (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
      );
      assert.throws(
        () => new Capability({ id: "cap.v", type: "capability", version: -1 }),
        (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
      );
      assert.throws(
        () => new Capability({ id: "cap.v", type: "capability", version: 1.5 }),
        (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
      );
      const capability = new Capability({ id: "cap.v", type: "capability", version: 3 });
      assert.strictEqual(capability.version, 3);
    });

    it("resolves a node pinned to the registered capability version", async () => {
      const handler = plainCapabilityHandler("cap.pin.ok", async (input) => input.state.withValue("handled", "pinned"));
      const { capabilities, handlers } = registriesFor("cap.pin.ok", handler, 2);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.pin.ok", capabilityVersion: 2 })]);

      const execution = await executor.execute(version, { id: "pin-ok" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual((execution.run.result?.finalState as State).get("handled"), "pinned");
    });

    it("fails a pinned node with kind capability when the registered version differs", async () => {
      const handler = plainCapabilityHandler("cap.pin.mismatch", async (input) => input.state);
      const { capabilities, handlers } = registriesFor("cap.pin.mismatch", handler, 3);
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.pin.mismatch", capabilityVersion: 2 }),
      ]);

      const execution = await executor.execute(version, { id: "pin-mismatch", eventBus: bus });

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /not available at version 2/);
      assert.match(execution.run.error ?? "", /registered version 3/);
      const node = execution.nodes.get("a");
      assert.strictEqual(node?.status, "failed");
      assert.strictEqual(node?.failureKind, "capability");
      const nodeFailed = bus.historyOf("execution.node.failed")[0]?.payload;
      assert.strictEqual(nodeFailed?.kind, "capability");
      const runFailed = bus.historyOf("execution.run.failed")[0]?.payload;
      assert.strictEqual(runFailed?.kind, "capability");
    });

    it("keeps an unpinned node resolved to whatever version is registered", async () => {
      const handler = plainCapabilityHandler("cap.pin.none", async (input) => input.state.withValue("handled", "unpinned"));
      const { capabilities, handlers } = registriesFor("cap.pin.none", handler, 4);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.pin.none" })]);

      const execution = await executor.execute(version, { id: "pin-none" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual((execution.run.result?.finalState as State).get("handled"), "unpinned");
    });
  });

  describe("capability handler failure and cancellation semantics", () => {
    it("surfaces a capability handler failure as kind capability", async () => {
      const handler = plainCapabilityHandler("cap.boom", async () => {
        throw new Error("handler exploded");
      });
      const { capabilities, handlers } = registriesFor("cap.boom", handler);
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.boom" })]);

      const execution = await executor.execute(version, { id: "cap-boom", eventBus: bus });

      assert.strictEqual(execution.status, "failed");
      const node = execution.nodes.get("a");
      assert.strictEqual(node?.failureKind, "capability");
      assert.strictEqual(bus.historyOf("execution.node.failed")[0]?.payload?.kind, "capability");
      assert.strictEqual(bus.historyOf("execution.run.failed")[0]?.payload?.kind, "capability");
    });

    it("leaves failureKind unset when a capability node is cancelled", async () => {
      const controller = new AbortController();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.soft",
        run: async (input) => {
          await gate;
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.soft", handler);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const bus = new EventBus();
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.soft" })]);
      const nodeStarted = new Promise<void>((resolve) => bus.once("execution.node.started", () => resolve()));

      const pending = executor.execute(version, { id: "cap-soft", signal: controller.signal, eventBus: bus });

      await nodeStarted;
      controller.abort();
      release();

      const execution = await pending;
      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(execution.nodes.get("a")?.failureKind, undefined);
    });
  });

  describe("resource version lifecycle", () => {
    it("matches a versioned reference to the registered resource version", async () => {
      let captured: Readonly<Record<string, Resource>> | undefined;
      const handler = plainCapabilityHandler("cap.db", async (input) => {
        captured = input.resources;
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.db", handler);
      const resourceRegistry = new ResourceRegistry();
      resourceRegistry.register(resourceOf("db", "2", { kind: "postgres" }));
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: new RegistryResourceResolver(resourceRegistry),
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.db",
          resourceReferences: [{ resourceId: "db", version: "2" }],
        }),
      ]);

      const execution = await executor.execute(version, { id: "res-version-ok" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(captured?.["db"]?.version, "2");
    });

    it("fails a versioned reference with kind resource when the registered version differs", async () => {
      let handlerRan = false;
      const handler = plainCapabilityHandler("cap.db.mismatch", async (input) => {
        handlerRan = true;
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.db.mismatch", handler);
      const resourceRegistry = new ResourceRegistry();
      resourceRegistry.register(resourceOf("db", "3"));
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: new RegistryResourceResolver(resourceRegistry),
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.db.mismatch",
          resourceReferences: [{ resourceId: "db", version: "2" }],
        }),
      ]);

      const execution = await executor.execute(version, { id: "res-version-mismatch" });

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /did not resolve reference "db"/);
      assert.strictEqual(handlerRan, false);
      assert.strictEqual(execution.nodes.get("a")?.failureKind, "resource");
    });

    it("resolves an unversioned reference regardless of the registered resource version", async () => {
      let captured: Readonly<Record<string, Resource>> | undefined;
      const handler = plainCapabilityHandler("cap.db.loose", async (input) => {
        captured = input.resources;
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.db.loose", handler);
      const resourceRegistry = new ResourceRegistry();
      resourceRegistry.register(resourceOf("db", "9"));
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: new RegistryResourceResolver(resourceRegistry),
      });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.db.loose", resourceReferences: [{ resourceId: "db" }] }),
      ]);

      const execution = await executor.execute(version, { id: "res-version-loose" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(captured?.["db"]?.version, "9");
    });

    it("fails with kind resource when an async resolver rejects", async () => {
      let handlerRan = false;
      const handler = plainCapabilityHandler("cap.async.reject", async (input) => {
        handlerRan = true;
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.async.reject", handler);
      const resolver: ResourceResolver = {
        resolve: async () => {
          throw new Error("downstream unavailable");
        },
      };
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: resolver,
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.async.reject",
          resourceReferences: [{ resourceId: "db" }],
        }),
      ]);

      const execution = await executor.execute(version, { id: "res-async-reject" });

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /downstream unavailable/);
      assert.strictEqual(handlerRan, false);
      assert.strictEqual(execution.nodes.get("a")?.failureKind, "resource");
    });
  });

  describe("capability and resource persistence", () => {
    it("round-trips capabilityVersion and resource references through pipeline storage", () => {
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.round",
          capabilityVersion: 2,
          resourceReferences: [{ resourceId: "db", version: "5" }],
        }),
      ]);

      const stored = toStoredPipelineVersion(version);
      assert.strictEqual(stored.graph.nodes[0]?.capabilityId, "cap.round");
      assert.strictEqual(stored.graph.nodes[0]?.capabilityVersion, 2);
      assert.deepStrictEqual(stored.graph.nodes[0]?.resourceReferences, [{ resourceId: "db", version: "5" }]);

      const restored = fromStoredPipelineVersion(stored);
      const node = restored.graph.nodes.get("a");
      assert.strictEqual(node?.capabilityId, "cap.round");
      assert.strictEqual(node?.capabilityVersion, 2);
      assert.deepStrictEqual(node?.resourceReferences, [{ resourceId: "db", version: "5" }]);
    });

    it("executes a capability node after a full pipeline round-trip including version and resources", async () => {
      const handler = plainCapabilityHandler("cap.hydrate", async (input) => input.state.withValue("handled", "hydrated"));
      const { capabilities, handlers } = registriesFor("cap.hydrate", handler, 7);
      const resourceRegistry = new ResourceRegistry();
      resourceRegistry.register(resourceOf("db", "11"));
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: new RegistryResourceResolver(resourceRegistry),
      });
      const original = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.hydrate",
          capabilityVersion: 7,
          resourceReferences: [{ resourceId: "db", version: "11" }],
        }),
      ]);

      const restored = fromStoredPipelineVersion(JSON.parse(JSON.stringify(toStoredPipelineVersion(original))));
      const execution = await executor.execute(restored, { id: "cap-hydrate" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual((execution.run.result?.finalState as State).get("handled"), "hydrated");
    });

    it("rejects a persisted capabilityVersion that is not a positive integer", () => {
      const base = validPipelineStored();
      for (const bad of [0, -1, "3", 1.5]) {
        const stored = structuredClone(base);
        stored.versions[0].graph.nodes[0].capabilityVersion = bad;
        assert.throws(
          () => parseStoredPipeline(stored),
          (error) => error instanceof DomainError && error.message.includes("Malformed persisted pipeline data")
        );
      }
    });

    it("rejects persisted resourceReferences that are not an array", () => {
      const stored = structuredClone(validPipelineStored());
      stored.versions[0].graph.nodes[0].resourceReferences = "db";
      assert.throws(
        () => parseStoredPipeline(stored),
        (error) => error instanceof DomainError && error.message.includes("Malformed persisted pipeline data")
      );
    });

    it("rejects a persisted resource reference entry with a non-string resourceId", () => {
      const stored = structuredClone(validPipelineStored());
      stored.versions[0].graph.nodes[0].resourceReferences = [{ resourceId: 5 }];
      assert.throws(
        () => parseStoredPipeline(stored),
        (error) => error instanceof DomainError && error.message.includes("Malformed persisted pipeline data")
      );
    });
  });

  describe("failureKind persistence", () => {
    it("persists the capability failure kind through Runtime and FileRunStore", async () => {
      const handler = plainCapabilityHandler("cap.persist.fail", async () => {
        throw new Error("persisted boom");
      });
      const { capabilities, handlers } = registriesFor("cap.persist.fail", handler);
      const filePath = join(tmpdirPath(), "cap-fail.json");
      const store = new FileRunStore({ filePath });
      const runtime = new Runtime({
        executor: new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }),
        runStore: store,
      });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.persist.fail" })]);

      const execution = await runtime.execute(version, { id: "cap-fail-persisted" });

      assert.strictEqual(execution.status, "failed");
      const status = runtime.status("cap-fail-persisted");
      assert.strictEqual(status.nodes.find((n) => n.nodeId === "a")?.failureKind, "capability");
      const stored = store.get("cap-fail-persisted");
      assert.strictEqual(stored?.nodes?.find((n) => n.nodeId === "a")?.failureKind, "capability");
    });

    it("persists the resource failure kind through Runtime and FileRunStore", async () => {
      const handler = plainCapabilityHandler("cap.persist.res", async (input) => input.state);
      const { capabilities, handlers } = registriesFor("cap.persist.res", handler);
      const filePath = join(tmpdirPath(), "res-fail.json");
      const store = new FileRunStore({ filePath });
      const runtime = new Runtime({
        executor: new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }),
        runStore: store,
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.persist.res",
          resourceReferences: [{ resourceId: "db" }],
        }),
      ]);

      const execution = await runtime.execute(version, { id: "res-fail-persisted" });

      assert.strictEqual(execution.status, "failed");
      assert.strictEqual(runtime.status("res-fail-persisted").nodes.find((n) => n.nodeId === "a")?.failureKind, "resource");
    });

    it("round-trips failureKind through toStoredNodeRun and parseStoredRun, keeping legacy records valid", async () => {
      const handler = plainCapabilityHandler("cap.round.fk", async () => {
        throw new Error("fk boom");
      });
      const { capabilities, handlers } = registriesFor("cap.round.fk", handler);
      const execution = await new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }).execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.round.fk" })]),
        { id: "fk-round" }
      );
      const nodeRun = execution.nodes.get("a");
      assert.ok(nodeRun);
      assert.strictEqual(nodeRun.failureKind, "capability");

      const stored = toStoredNodeRun(nodeRun);
      assert.strictEqual(stored.failureKind, "capability");
      const parsed = parseStoredRun({ id: "fk-round", status: "failed", nodes: [stored] });
      assert.strictEqual(parsed.nodes?.[0]?.failureKind, "capability");

      const legacy = parseStoredRun({
        id: "legacy",
        status: "failed",
        nodes: [{ nodeId: "a", nodeType: "t", status: "failed", error: "old boom" }],
      });
      assert.strictEqual(legacy.nodes?.[0]?.failureKind, undefined);
    });

    it("rejects a malformed persisted failureKind", () => {
      const stored = {
        id: "r",
        status: "failed",
        nodes: [{ nodeId: "a", nodeType: "t", status: "failed", failureKind: "boom" }],
      };
      assert.throws(
        () => parseStoredRun(stored),
        (error) => error instanceof DomainError && error.message.includes("Malformed persisted run data") && error.message.includes("failureKind")
      );
    });

    it("exposes failureKind through Runtime status after a restart hydration", async () => {
      const handler = plainCapabilityHandler("cap.restart.fail", async () => {
        throw new Error("restart boom");
      });
      const { capabilities, handlers } = registriesFor("cap.restart.fail", handler);
      const filePath = join(tmpdirPath(), "restart.json");
      const store = new FileRunStore({ filePath });
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.restart.fail" })]);

      await new Runtime({ executor, runStore: store }).execute(version, { id: "cap-restart" });

      const reloaded = new Runtime({ executor: new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }), runStore: store });
      const status = reloaded.status("cap-restart");
      assert.strictEqual(status.nodes.find((n) => n.nodeId === "a")?.failureKind, "capability");
    });
  });

  describe("execution context contract", () => {
    it("passes exactly the frozen execution contract to the handler", async () => {
      const controller = new AbortController();
      let received: { input: CapabilityNodeInput; context: CapabilityExecutionContext } | undefined;
      const handler = plainCapabilityHandler("cap.contract", async (input, context) => {
        received = { input, context };
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.contract", handler);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "c", type: "primitive", capabilityId: "cap.contract" })]);

      const execution = await executor.execute(version, {
        id: "contract",
        signal: controller.signal,
        initialState: new State({ schema: version.stateSchema, value: { name: "Ada" } }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.ok(received);
      assert.deepStrictEqual(Object.keys(received.input), ["node", "state", "signal", "artifacts", "resources"]);
      assert.deepStrictEqual(Object.keys(received.context), ["executionId", "version"]);
      assert.strictEqual(received.input.node.id, "c");
      assert.strictEqual(received.input.signal, controller.signal);
      assert.strictEqual(received.context.executionId, "contract");
      assert.strictEqual(received.context.version, version);
    });
  });

  describe("capability artifacts and attempts", () => {
    it("commits artifacts from a successful capability attempt", async () => {
      const handler = plainCapabilityHandler("cap.art.ok", async (input) => {
        input.artifacts.emit(artifact("key", { rows: 3 }));
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.art.ok", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.art.ok" })]);

      const execution = await executor.execute(version, { id: "cap-art-ok" });

      assert.strictEqual(execution.status, "succeeded");
      assert.deepStrictEqual(store.get("key")?.ref, { kind: "content", content: { rows: 3 } });
    });

    it("commits only the successful attempt's artifacts on retry", async () => {
      let calls = 0;
      const handler = plainCapabilityHandler("cap.art.retry", async (input) => {
        calls += 1;
        if (calls === 1) {
          input.artifacts.emit(artifact("first"));
          throw new Error("air boom");
        }
        input.artifacts.emit(artifact("second"));
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.art.retry", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.art.retry", retryPolicy: { maxAttempts: 2 } }),
      ]);

      const execution = await executor.execute(version, { id: "cap-art-retry" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(store.get("first"), null);
      assert.strictEqual(store.get("second")?.id, "second");
      assert.strictEqual(execution.nodes.get("a")?.attempts[0]?.failureKind, "capability");
    });

    it("commits no artifacts when a capability node exhausts its attempts", async () => {
      const handler = plainCapabilityHandler("cap.art.fail", async (input) => {
        input.artifacts.emit(artifact("lost"));
        throw new Error("always boom");
      });
      const { capabilities, handlers } = registriesFor("cap.art.fail", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.art.fail", retryPolicy: { maxAttempts: 2 } }),
      ]);

      const execution = await executor.execute(version, { id: "cap-art-fail" });

      assert.strictEqual(execution.status, "failed");
      assert.strictEqual(store.get("lost"), null);
      assert.strictEqual(store.list().length, 0);
      assert.strictEqual(execution.nodes.get("a")?.failureKind, "capability");
    });
  });

  describe("retry integration frozen contract", () => {
    it("re-resolves resources once per attempt with a fresh resolver result", async () => {
      let handlerCalls = 0;
      const handler = plainCapabilityHandler("cap.retry.res", async (input) => {
        handlerCalls += 1;
        if (handlerCalls < 3) {
          throw new Error("retry res boom");
        }
        return input.state.withValue("count", handlerCalls);
      });
      const { capabilities, handlers } = registriesFor("cap.retry.res", handler);
      const registered: Resource[] = [];
      const resolver: ResourceResolver = {
        resolve: async (reference) => {
          const fresh = resourceOf(reference.resourceId, "1", { generation: registered.length + 1 });
          registered.push(fresh);
          return fresh;
        },
      };
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: resolver,
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.retry.res",
          resourceReferences: [{ resourceId: "db" }],
          retryPolicy: { maxAttempts: 3 },
        }),
      ]);

      const execution = await executor.execute(version, { id: "retry-re-resolve" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(registered.length, 3);
      assert.strictEqual(execution.nodes.get("a")?.attempts.length, 3);
      assert.strictEqual((registered[0]?.metadata as { generation: number }).generation, 1);
      assert.strictEqual((registered[2]?.metadata as { generation: number }).generation, 3);
    });

    it("tags transient resource failures on attempts before a successful retry", async () => {
      let attempts = 0;
      const handler = plainCapabilityHandler("cap.retry.resfail", async (input) => input.state.withValue("count", 1));
      const { capabilities, handlers } = registriesFor("cap.retry.resfail", handler);
      const resolver: ResourceResolver = {
        resolve: async (reference) => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("flaky downstream");
          }
          return resourceOf(reference.resourceId);
        },
      };
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: resolver,
      });
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.retry.resfail",
          resourceReferences: [{ resourceId: "db" }],
          retryPolicy: { maxAttempts: 3 },
        }),
      ]);

      const execution = await executor.execute(version, { id: "resfail-retry" });

      assert.strictEqual(execution.status, "succeeded");
      const attemptsList = execution.nodes.get("a")?.attempts ?? [];
      assert.strictEqual(attemptsList.length, 3);
      assert.strictEqual(attemptsList[0]?.status, "failed");
      assert.strictEqual(attemptsList[0]?.failureKind, "resource");
      assert.strictEqual(attemptsList[1]?.failureKind, "resource");
      assert.strictEqual(attemptsList[2]?.status, "succeeded");
    });

    it("aggregates the capability failure kind on the node after exhausting attempts", async () => {
      const handler = plainCapabilityHandler("cap.retry.exhaust", async () => {
        throw new Error("never succeeds");
      });
      const { capabilities, handlers } = registriesFor("cap.retry.exhaust", handler);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.retry.exhaust", retryPolicy: { maxAttempts: 3 } }),
      ]);

      const execution = await executor.execute(version, { id: "cap-exhaust" });

      assert.strictEqual(execution.status, "failed");
      const node = execution.nodes.get("a");
      assert.strictEqual(node?.failureKind, "capability");
      const failedAttempts = (node?.attempts ?? []).filter((attempt) => attempt.status === "failed");
      assert.strictEqual(failedAttempts.length, 3);
      assert.ok(failedAttempts.every((attempt) => attempt.failureKind === "capability"));
    });
  });

  describe("observability", () => {
    it("distinguishes action, capability, and resource failures on node.failed events", async () => {
      const failingAction: NodeAction = {
        type: "pr",
        run: async () => {
          throw new Error("plain boom");
        },
      };

      const capHandler = plainCapabilityHandler("cap.obs.fail", async () => {
        throw new Error("cap boom");
      });
      const { capabilities, handlers } = registriesFor("cap.obs.fail", capHandler);

      const resourceNode: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.obs.res",
        run: async (input) => input.state,
      };
      const { capabilities: caps2, handlers: hdls2 } = registriesFor("cap.obs.res", resourceNode);

      const actionBus = new EventBus();
      const actionExec = await new Executor({ actions: [failingAction] }).execute(
        versionOf([new Node({ id: "a", type: "pr" })]),
        { id: "obs-action", eventBus: actionBus }
      );
      assert.strictEqual(actionExec.status, "failed");
      assert.strictEqual(actionBus.historyOf("execution.node.failed")[0]?.payload?.kind, "action");

      const capBus = new EventBus();
      const capExec = await new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }).execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.obs.fail" })]),
        { id: "obs-cap", eventBus: capBus }
      );
      assert.strictEqual(capExec.status, "failed");
      assert.strictEqual(capBus.historyOf("execution.node.failed")[0]?.payload?.kind, "capability");

      const resBus = new EventBus();
      const resExec = await new Executor({
        capabilityRegistry: caps2,
        capabilityHandlerRegistry: hdls2,
        resourceResolver: {
          resolve: async () => {
            throw new Error("res boom");
          },
        },
      }).execute(
        versionOf([
          new Node({ id: "a", type: "primitive", capabilityId: "cap.obs.res", resourceReferences: [{ resourceId: "db" }] }),
        ]),
        { id: "obs-res", eventBus: resBus }
      );
      assert.strictEqual(resExec.status, "failed");
      assert.strictEqual(resBus.historyOf("execution.node.failed")[0]?.payload?.kind, "resource");
    });

    it("emits attempt.failed with the failure kind during capability retries", async () => {
      let calls = 0;
      const handler = plainCapabilityHandler("cap.obs.attempt", async (input) => {
        calls += 1;
        if (calls < 2) {
          throw new Error("try again");
        }
        return input.state;
      });
      const { capabilities, handlers } = registriesFor("cap.obs.attempt", handler);
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([
        new Node({ id: "a", type: "primitive", capabilityId: "cap.obs.attempt", retryPolicy: { maxAttempts: 2 } }),
      ]);

      const execution = await executor.execute(version, { id: "obs-attempt", eventBus: bus });

      assert.strictEqual(execution.status, "succeeded");
      const failedAttempts = bus.historyOf("execution.node.attempt.failed");
      assert.strictEqual(failedAttempts.length, 1);
      assert.strictEqual(failedAttempts[0]?.payload?.kind, "capability");
      assert.strictEqual(failedAttempts[0]?.payload?.attempt, 1);
    });
  });
});

function validPipelineStored(): {
  id: string;
  name: string;
  versions: Array<{
    version: number;
    graph: {
      nodes: Array<{
        id: string;
        type: string;
        capabilityId?: string;
        capabilityVersion?: number;
        resourceReferences?: unknown;
      }>;
      edges: Array<Record<string, never>>;
    };
    stateSchema: { name: string; fields: Record<string, never> };
  }>;
} {
  return {
    id: "p",
    name: "p",
    versions: [
      {
        version: 1,
        graph: {
          nodes: [{ id: "a", type: "primitive", capabilityId: "cap.x", capabilityVersion: 2, resourceReferences: [] }],
          edges: [],
        },
        stateSchema: { name: "s", fields: {} },
      },
    ],
  };
}