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
  State,
  StateSchema,
  type CapabilityHandler,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  ExecutionCancelledError,
  Executor,
  FileArtifactStore,
  MemoryArtifactStore,
  type Artifact,
  type ArtifactStore,
  type CapabilityExecutionContext,
  type CapabilityNodeInput,
  type NodeAction,
} from "../../src/runtime/index.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "runtime", fields });
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function registriesFor(capabilityId: string, handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>): {
  readonly capabilities: CapabilityRegistry;
  readonly handlers: CapabilityHandlerRegistry;
} {
  const capabilities = new CapabilityRegistry();
  capabilities.register(new Capability({ id: capabilityId, type: "capability", version: 1 }));
  const handlers = new CapabilityHandlerRegistry();
  handlers.register(handler);
  return { capabilities, handlers };
}

function artifact(id: string, content: unknown = id): Artifact {
  return { id, type: "report", name: `artifact-${id}`, ref: { kind: "content", content } };
}

describe("runtime/Executor artifact integration", () => {
  describe("execution without an ArtifactStore", () => {
    it("succeeds and emits artifacts as a no-op", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.noop",
        run: async (input) => {
          input.artifacts.emit(artifact("n-a"));
          return input.state.withValue("count", 1);
        },
      };
      const { capabilities, handlers } = registriesFor("cap.noop", handler);
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.noop" })]);

      const execution = await executor.execute(version, { id: "no-store" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(((execution.run.result?.finalState) as State).get("count"), 1);
    });

    it("keeps the action path working without an ArtifactStore", async () => {
      const action: NodeAction = {
        type: "plain",
        run: ({ state, artifacts }) => {
          artifacts.emit(artifact("act-a"));
          return state.withValue("count", 5);
        },
      };
      const version = versionOf([new Node({ id: "p", type: "plain" })]);
      const execution = await new Executor({ actions: [action] }).execute(version, {
        id: "plain-no-store",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(((execution.run.result?.finalState) as State).get("count"), 5);
    });
  });

  describe("injected MemoryArtifactStore", () => {
    it("persists artifacts emitted during capability execution", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.emit",
        run: async (input) => {
          input.artifacts.emit(artifact("a-1", { rows: 3 }));
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.emit", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.emit" })]);

      const execution = await executor.execute(version, {
        id: "artifact-run",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "succeeded");
      const saved = store.get("a-1");
      assert.ok(saved);
      assert.strictEqual(saved.id, "a-1");
      assert.strictEqual(saved.type, "report");
      assert.deepStrictEqual(saved.ref, { kind: "content", content: { rows: 3 } });
    });

    it("persists several artifacts from one execution", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.many",
        run: async (input) => {
          input.artifacts.emit(artifact("m-1"));
          input.artifacts.emit(artifact("m-2", { extra: true }));
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.many", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.many" })]);

      const execution = await executor.execute(version, {
        id: "many",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(store.list().length, 2);
      assert.ok(store.get("m-1"));
      assert.deepStrictEqual(store.get("m-2")?.ref, { kind: "content", content: { extra: true } });
    });

    it("commits artifacts from consecutive capability nodes in one graph", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.stage",
        run: async (input) => {
          input.artifacts.emit(artifact(input.node.id));
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.stage", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf(
        [new Node({ id: "x", type: "primitive", capabilityId: "cap.stage" }), new Node({ id: "y", type: "primitive", capabilityId: "cap.stage" })],
        [["x", "y"]]
      );

      const execution = await executor.execute(version, { id: "stages", initialState: new State({ schema: version.stateSchema, value: {} }) });

      assert.strictEqual(execution.status, "succeeded");
      assert.deepStrictEqual(store.list().map((a) => a.id).sort(), ["x", "y"]);
    });

    it("persists artifacts from plain actions unchanged on the action path", async () => {
      const action: NodeAction = {
        type: "emitter",
        run: ({ state, artifacts }) => {
          artifacts.emit(artifact("emitter-1"));
          return state.withValue("count", (state.get<number>("count") ?? 0) + 1);
        },
      };
      const store = new MemoryArtifactStore();
      const version = versionOf([new Node({ id: "e", type: "emitter" })]);
      const execution = await new Executor({ actions: [action], artifactStore: store }).execute(version, {
        id: "action-artifact",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(store.get("emitter-1")?.name, "artifact-emitter-1");
      assert.strictEqual(((execution.run.result?.finalState) as State).get("count"), 1);
    });
  });

  describe("artifact persistence across a fresh file store", () => {
    it("durably persists execution artifacts through FileArtifactStore", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sprintdesk-exe-artifact-"));
      try {
        const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
          capabilityId: "cap.durable",
          run: async (input) => {
            input.artifacts.emit(artifact("durable-1", { kept: true }));
            return input.state;
          },
        };
        const { capabilities, handlers } = registriesFor("cap.durable", handler);
        const file = join(dir, "artifacts.json");
        const store = new FileArtifactStore({ filePath: file });
        const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.durable" })]);

        const execution = await executor.execute(version, {
          id: "durable",
          initialState: new State({ schema: version.stateSchema, value: {} }),
        });
        assert.strictEqual(execution.status, "succeeded");

        const reloaded = new FileArtifactStore({ filePath: file });
        assert.strictEqual(reloaded.get("durable-1")?.name, "artifact-durable-1");
        assert.deepStrictEqual(reloaded.get("durable-1")?.ref, { kind: "content", content: { kept: true } });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("artifact isolation between executions", () => {
    it("keeps two executions' artifacts distinct", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.iso",
        run: async (input, context) => {
          input.artifacts.emit(artifact(context.executionId));
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.iso", handler);
      const store = new MemoryArtifactStore();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.iso" })]);

      const first = await executor.execute(version, { id: "iso-1", initialState: new State({ schema: version.stateSchema, value: {} }) });
      const second = await executor.execute(version, { id: "iso-2", initialState: new State({ schema: version.stateSchema, value: {} }) });

      assert.strictEqual(first.status, "succeeded");
      assert.strictEqual(second.status, "succeeded");
      assert.deepStrictEqual(store.list().map((a) => a.id).sort(), ["iso-1", "iso-2"]);
    });

    it("emits nothing when a run is cancelled after emitting", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.cancel-emit",
        run: async (input) => {
          input.artifacts.emit(artifact("never-persisted"));
          throw new ExecutionCancelledError("stopped");
        },
      };
      const { capabilities, handlers } = registriesFor("cap.cancel-emit", handler);
      const store = new MemoryArtifactStore();
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.cancel-emit" })]);

      const execution = await executor.execute(version, {
        id: "cancel-emit",
        eventBus: bus,
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(store.list().length, 0);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
    });
  });

  describe("artifact-store failure", () => {
    it("fails the run deterministically through the existing failure path", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.store-fail",
        run: async (input) => {
          input.artifacts.emit(artifact("will-fail"));
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.store-fail", handler);
      const failingStore: ArtifactStore = {
        save: () => {
          throw new DomainError({ code: "INVALID_INPUT", message: "artifact store full" });
        },
        get: () => null,
        list: () => [],
        delete: () => {},
      };
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: failingStore });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.store-fail" })]);

      const execution = await executor.execute(version, {
        id: "store-fail",
        eventBus: bus,
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /artifact store full/);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 1);
      assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
      assert.strictEqual(bus.historyOf("execution.run.finished").length, 0);
    });
  });

  describe("compatibility", () => {
    it("does not persist artifacts for a node whose action fails", async () => {
      const action: NodeAction = {
        type: "broken-action",
        run: ({ artifacts }) => {
          artifacts.emit(artifact("should-not-persist"));
          throw new Error("action blew up");
        },
      };
      const store = new MemoryArtifactStore();
      const version = versionOf([new Node({ id: "b", type: "broken-action" })]);
      const execution = await new Executor({ actions: [action], artifactStore: store }).execute(version, {
        id: "broken-action",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /action blew up/);
      assert.strictEqual(store.list().length, 0);
    });

    it("keeps cancellation correct when an abort lands mid-capability", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.slow",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new ExecutionCancelledError();
        },
      };
      const { capabilities, handlers } = registriesFor("cap.slow", handler);
      const store = new MemoryArtifactStore();
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, artifactStore: store });
      const version = versionOf([new Node({ id: "s", type: "primitive", capabilityId: "cap.slow" })]);

      const execution = await executor.execute(version, {
        id: "slow-cancel",
        eventBus: bus,
        signal: new AbortController().signal,
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(store.list().length, 0);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
    });
  });
});