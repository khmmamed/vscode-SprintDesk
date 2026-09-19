import * as assert from "assert";
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
  type ResourceReference,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  Executor,
  RegistryResourceResolver,
  type CapabilityExecutionContext,
  type CapabilityNodeInput,
  type ResourceResolver,
} from "../../src/runtime/index.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "runtime", fields });
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema({ tag: { type: "string", required: false } }),
  });
}

function resourceOf(id: string, metadata: Readonly<Record<string, unknown>> = {}): Resource {
  return new Resource({ id, type: "test-resource", version: "1", metadata });
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

describe("runtime/Executor resource resolution", () => {
  it("resolves declared resources before the handler runs and passes them through", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.use-resource",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.use-resource", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(resourceOf("db", { kind: "postgres" }));
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: new RegistryResourceResolver(resourceRegistry),
    });
    const version = versionOf([
      new Node({ id: "a", type: "primitive", capabilityId: "cap.use-resource", resourceReferences: [{ resourceId: "db" }] }),
    ]);

    const execution = await executor.execute(version, { id: "resources-passed" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.strictEqual(Object.keys(captured).length, 1);
    const resolved = captured["db"];
    assert.strictEqual(resolved.id, "db");
    assert.strictEqual(resolved.type, "test-resource");
    assert.strictEqual((resolved.metadata as { kind: string }).kind, "postgres");
  });

  it("exposes only the resources declared by that node", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.scoped",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.scoped", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(resourceOf("db"));
    resourceRegistry.register(resourceOf("cache"));
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: new RegistryResourceResolver(resourceRegistry),
    });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.scoped",
        resourceReferences: [{ resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-scoped" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.deepStrictEqual(Object.keys(captured), ["db"]);
  });

  it("still provides an empty resources object when no references are declared", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.plain",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.plain", handler);
    const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
    const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.plain" })]);

    const execution = await executor.execute(version, { id: "resources-empty" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.deepStrictEqual(Object.keys(captured), []);
  });

  it("resolves multiple distinct references for one node", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.multi",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.multi", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(resourceOf("a"));
    resourceRegistry.register(resourceOf("b"));
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: new RegistryResourceResolver(resourceRegistry),
    });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.multi",
        resourceReferences: [{ resourceId: "a" }, { resourceId: "b" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-multi" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.deepStrictEqual(Object.keys(captured), ["a", "b"]);
    assert.strictEqual(captured["a"].id, "a");
    assert.strictEqual(captured["b"].id, "b");
  });

  it("passes the reference to the resolver and resolves duplicate references once", async () => {
    const calls: ResourceReference[] = [];
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.dedup",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.dedup", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(resourceOf("db"));
    const resolver: ResourceResolver = {
      resolve: (reference) => {
        calls.push(reference);
        return resourceRegistry.get(reference.resourceId);
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
        capabilityId: "cap.dedup",
        resourceReferences: [{ resourceId: "db" }, { resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-dedup" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { resourceId: "db" });
    assert.ok(captured);
    assert.deepStrictEqual(Object.keys(captured), ["db"]);
  });

  it("supports an asynchronous resolver", async () => {
    let captured: Readonly<Record<string, Resource>> | undefined;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.async",
      run: async (input) => {
        captured = input.resources;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.async", handler);
    const resourceRegistry = new ResourceRegistry();
    resourceRegistry.register(resourceOf("db"));
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: {
        resolve: async (reference) => resourceRegistry.get(reference.resourceId),
      },
    });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.async",
        resourceReferences: [{ resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-async" });

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(captured);
    assert.strictEqual(captured["db"].id, "db");
  });

  it("fails the run without executing the handler when a resource cannot be resolved", async () => {
    let handlerRan = false;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.missing",
      run: async (input) => {
        handlerRan = true;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.missing", handler);
    const resourceRegistry = new ResourceRegistry();
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: new RegistryResourceResolver(resourceRegistry),
    });
    const bus = new EventBus();
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.missing",
        resourceReferences: [{ resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-missing", eventBus: bus });

    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /Resource with id "db" not found/);
    assert.strictEqual(handlerRan, false);
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 1);
  });

  it("fails deterministically when no resolver is configured for declared references", async () => {
    let handlerRan = false;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.noresolver",
      run: async (input) => {
        handlerRan = true;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.noresolver", handler);
    const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.noresolver",
        resourceReferences: [{ resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-noresolver" });

    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /No resource resolver configured/);
    assert.strictEqual(handlerRan, false);
  });

  it("rejects a resolver that returns a resource with a different id", async () => {
    let handlerRan = false;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.mismatch",
      run: async (input) => {
        handlerRan = true;
        return input.state;
      },
    };
    const { capabilities, handlers } = registriesFor("cap.mismatch", handler);
    const executor = new Executor({
      capabilityRegistry: capabilities,
      capabilityHandlerRegistry: handlers,
      resourceResolver: {
        resolve: () => resourceOf("other"),
      },
    });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.mismatch",
        resourceReferences: [{ resourceId: "db" }],
      }),
    ]);

    const execution = await executor.execute(version, { id: "resources-mismatch" });

    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /did not resolve reference "db"/);
    assert.strictEqual(handlerRan, false);
  });

  it("rejects resource references on nodes without a capability", async () => {
    let actionRan = false;
    const executor = new Executor({
      actions: [
        {
          type: "primitive",
          run: ({ state }) => {
            actionRan = true;
            return state;
          },
        },
      ],
    });
    const version = versionOf([new Node({ id: "a", type: "primitive", resourceReferences: [{ resourceId: "db" }] })]);

    const execution = await executor.execute(version, { id: "resources-nocapability" });

    assert.strictEqual(execution.status, "failed");
    assert.match(execution.run.error ?? "", /not a capability node/);
    assert.strictEqual(actionRan, false);
  });

  describe("cancellation", () => {
    it("never resolves or runs the handler for an already-aborted execution", async () => {
      let handlerRan = false;
      let resolveCalls = 0;
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.preabort",
        run: async (input) => {
          handlerRan = true;
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.preabort", handler);
      const resourceRegistry = new ResourceRegistry();
      resourceRegistry.register(resourceOf("db"));
      const resolver: ResourceResolver = {
        resolve: (reference) => {
          resolveCalls += 1;
          return resourceRegistry.get(reference.resourceId);
        },
      };
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: resolver,
      });
      const bus = new EventBus();
      const controller = new AbortController();
      controller.abort();
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.preabort",
          resourceReferences: [{ resourceId: "db" }],
        }),
      ]);

      const execution = await executor.execute(version, { id: "resources-preabort", eventBus: bus, signal: controller.signal });

      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(resolveCalls, 0);
      assert.strictEqual(handlerRan, false);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
    });

    it("cancels before the handler runs when an abort lands during asynchronous resolution", async () => {
      let handlerRan = false;
      let release!: (resource: Resource) => void;
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.midabort",
        run: async (input) => {
          handlerRan = true;
          return input.state;
        },
      };
      const { capabilities, handlers } = registriesFor("cap.midabort", handler);
      const executor = new Executor({
        capabilityRegistry: capabilities,
        capabilityHandlerRegistry: handlers,
        resourceResolver: {
          resolve: () =>
            new Promise<Resource>((resolve) => {
              release = resolve;
            }),
        },
      });
      const bus = new EventBus();
      const controller = new AbortController();
      const version = versionOf([
        new Node({
          id: "a",
          type: "primitive",
          capabilityId: "cap.midabort",
          resourceReferences: [{ resourceId: "db" }],
        }),
      ]);

      const pending = executor.execute(version, { id: "resources-midabort", eventBus: bus, signal: controller.signal });
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort();
      release(resourceOf("db"));
      const execution = await pending;

      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(handlerRan, false);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
    });
  });
});

describe("Node resource references", () => {
  it("defaults to no references", () => {
    const node = new Node({ id: "a", type: "primitive" });
    assert.deepStrictEqual(node.resourceReferences, []);
  });

  it("trims resource ids and freezes the declarations", () => {
    const node = new Node({ id: "a", type: "primitive", resourceReferences: [{ resourceId: "  db  " }] });
    assert.deepStrictEqual(node.resourceReferences, [{ resourceId: "db" }]);
    assert.ok(Object.isFrozen(node.resourceReferences));
    assert.ok(Object.isFrozen(node.resourceReferences[0]));
  });

  it("rejects non-string resource ids", () => {
    assert.throws(
      () => new Node({ id: "a", type: "primitive", resourceReferences: [{ resourceId: 7 as unknown as string }] }),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("rejects empty resource ids", () => {
    assert.throws(
      () => new Node({ id: "a", type: "primitive", resourceReferences: [{ resourceId: "   " }] }),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });
});