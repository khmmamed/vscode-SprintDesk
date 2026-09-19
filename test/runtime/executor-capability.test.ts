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
  State,
  StateSchema,
  type CapabilityHandler,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  ExecutionCancelledError,
  Executor,
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
    stateSchema: schema({
      name: { type: "string", required: false },
      count: { type: "number", required: false },
      tag: { type: "string", required: false },
      handled: { type: "string", required: false },
    }),
  });
}

class RegistryPair {
  readonly capabilities = new CapabilityRegistry();
  readonly handlers = new CapabilityHandlerRegistry();

  constructor(capabilityId: string, handler?: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>) {
    this.capabilities.register(new Capability({ id: capabilityId, type: "capability", version: 1 }));
    if (handler) {
      this.handlers.register(handler);
    }
  }
}

function finiteDeferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runtime/Executor capability integration", () => {
  describe("basic execution", () => {
    it("executes a node with a capability through its handler", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.handled",
        run: async (input) => input.state.withValue("handled", "yes"),
      };
      const registries = new RegistryPair("cap.handled", handler);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.handled" })]);

      const execution = await executor.execute(version, { id: "cap-basic" });

      assert.strictEqual(execution.status, "succeeded");
      const finalState = execution.run.result?.finalState as State;
      assert.strictEqual(finalState.get("handled"), "yes");
    });

    it("passes the expected input and context to the handler", async () => {
      const controller = new AbortController();
      let received: { input: CapabilityNodeInput; context: CapabilityExecutionContext } | undefined;
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.observe",
        run: async (input, context) => {
          received = { input, context };
          return input.state;
        },
      };
      const registries = new RegistryPair("cap.observe", handler);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });
      const version = versionOf([new Node({ id: "ob", type: "primitive", capabilityId: "cap.observe" })]);

      const execution = await executor.execute(version, {
        id: "cc1",
        signal: controller.signal,
        initialState: new State({ schema: version.stateSchema, value: { name: "Ada" } }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(received?.input.node.id, "ob");
      assert.strictEqual(received?.input.state.get("name"), "Ada");
      assert.strictEqual(received?.input.signal, controller.signal);
      assert.strictEqual(received?.context.executionId, "cc1");
      assert.strictEqual(received?.context.version, version);
    });

    it("feeds the handler result through the normal execution events", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.stamp",
        run: async (input) => input.state.withValue("count", (input.state.get<number>("count") ?? 0) + 5),
      };
      const registries = new RegistryPair("cap.stamp", handler);
      const bus = new EventBus();
      const types: string[] = [];
      bus.onAny((event) => types.push(event.type));
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const version = versionOf([new Node({ id: "s", type: "primitive", capabilityId: "cap.stamp" })]);
      const execution = await executor.execute(version, {
        id: "ev",
        eventBus: bus,
        initialState: new State({ schema: version.stateSchema, value: { count: 0 } }),
      });

      assert.strictEqual(execution.status, "succeeded");
      assert.deepStrictEqual(types, [
        "execution.run.started",
        "execution.node.started",
        "execution.node.finished",
        "execution.run.finished",
      ]);
    });
  });

  describe("resolution", () => {
    it("fails clearly when the capability definition is missing", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.known",
        run: async (input) => input.state,
      };
      const registries = new RegistryPair("cap.known", handler);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.missing" })]),
        { id: "missing-cap" }
      );

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /cap\.missing/);
      assert.match(execution.run.error ?? "", /not found/i);
    });

    it("fails clearly when the handler is missing", async () => {
      const registries = new RegistryPair("cap.no-handler");
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.no-handler" })]),
        { id: "missing-handler" }
      );

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /cap\.no-handler/);
      assert.match(execution.run.error ?? "", /No handler registered/i);
    });

    it("keeps a capability definition without a handler valid until execution", async () => {
      const registries = new RegistryPair("cap.lazy");
      const version = versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.lazy" })]);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      assert.doesNotThrow(() => executor);
      assert.doesNotThrow(() => version.graph.getNode("a"));

      const execution = await executor.execute(version, { id: "lazy" });
      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /No handler registered/i);
    });

    it("fails clearly when no capability registry is configured at all", async () => {
      const registries = new RegistryPair("cap.alone");
      const executor = new Executor({ capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.alone" })]),
        { id: "no-caps" }
      );

      assert.strictEqual(execution.status, "failed");
      assert.strictEqual((execution.run.error ?? "").includes("No capability registry configured"), true);
    });
  });

  describe("compatibility", () => {
    it("keeps nodes without a capability on the existing NodeAction path", async () => {
      let actionCalls = 0;
      let handlerCalls = 0;
      const action: NodeAction = {
        type: "plain",
        run: ({ state }) => {
          actionCalls += 1;
          return state;
        },
      };
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.other",
        run: async (input) => {
          handlerCalls += 1;
          return input.state;
        },
      };
      const registries = new RegistryPair("cap.other", handler);
      const executor = new Executor({
        actions: [action],
        capabilityRegistry: registries.capabilities,
        capabilityHandlerRegistry: registries.handlers,
      });

      const execution = await executor.execute(versionOf([new Node({ id: "p", type: "plain" })]), { id: "plain" });

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(actionCalls, 1);
      assert.strictEqual(handlerCalls, 0);
    });

    it("lets capability and plain nodes coexist in one graph", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.mix",
        run: async (input) => input.state.withValue("handled", "stamped"),
      };
      const registries = new RegistryPair("cap.mix", handler);
      const counter: NodeAction = {
        type: "counter",
        run: ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
      };
      const executor = new Executor({
        actions: [counter],
        capabilityRegistry: registries.capabilities,
        capabilityHandlerRegistry: registries.handlers,
      });
      const version = versionOf(
        [new Node({ id: "c1", type: "primitive", capabilityId: "cap.mix" }), new Node({ id: "c2", type: "counter" })],
        [["c1", "c2"]]
      );

      const execution = await executor.execute(version, {
        id: "mix",
        initialState: new State({ schema: version.stateSchema, value: {} }),
      });

      assert.strictEqual(execution.status, "succeeded");
      const finalState = execution.run.result?.finalState as State;
      assert.strictEqual(finalState.get("handled"), "stamped");
      assert.strictEqual(finalState.get("count"), 1);
    });
  });

  describe("failure", () => {
    it("routes handler failure through the existing failure path", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.broken",
        run: async () => {
          throw new DomainError({ code: "INVALID_INPUT", message: "handler exploded" });
        },
      };
      const registries = new RegistryPair("cap.broken", handler);
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.broken" })]),
        { id: "boom", eventBus: bus }
      );

      assert.strictEqual(execution.status, "failed");
      assert.match(execution.run.error ?? "", /handler exploded/);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 1);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 0);
    });

    it("does not run downstream nodes after a handler failure", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.gate",
        run: async () => {
          throw new Error("stop here");
        },
      };
      const registries = new RegistryPair("cap.gate", handler);
      let downstreamCalls = 0;
      const downstream: NodeAction = {
        type: "sink",
        run: ({ state }) => {
          downstreamCalls += 1;
          return state;
        },
      };
      const bus = new EventBus();
      const started: Array<{ nodeId: string }> = [];
      bus.onAny((event) => {
        if (event.type === "execution.node.started") {
          started.push({ nodeId: String(event.payload.nodeId) });
        }
      });
      const executor = new Executor({
        actions: [downstream],
        capabilityRegistry: registries.capabilities,
        capabilityHandlerRegistry: registries.handlers,
      });
      const version = versionOf(
        [new Node({ id: "g", type: "primitive", capabilityId: "cap.gate" }), new Node({ id: "s", type: "sink" })],
        [["g", "s"]]
      );

      const execution = await executor.execute(version, { id: "stop-at-gate", eventBus: bus });

      assert.strictEqual(execution.status, "failed");
      assert.strictEqual(downstreamCalls, 0);
      assert.deepStrictEqual(
        started.map((s) => s.nodeId),
        ["g"]
      );
    });
  });

  describe("cancellation", () => {
    it("hands the abort signal to the handler", async () => {
      const controller = new AbortController();
      let received: AbortSignal | undefined;
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.signal",
        run: async (input) => {
          received = input.signal;
          return input.state;
        },
      };
      const registries = new RegistryPair("cap.signal", handler);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.signal" })]),
        { id: "sig", signal: controller.signal }
      );

      assert.strictEqual(execution.status, "succeeded");
      assert.strictEqual(received, controller.signal);
      assert.strictEqual(received?.aborted, false);
    });

    it("commits cancelled semantics when the handler cancels cooperatively", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.soft",
        run: async () => {
          throw new ExecutionCancelledError("cooperative stop");
        },
      };
      const registries = new RegistryPair("cap.soft", handler);
      const bus = new EventBus();
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const execution = await executor.execute(
        versionOf([new Node({ id: "a", type: "primitive", capabilityId: "cap.soft" })]),
        { id: "soft-cancel", eventBus: bus }
      );

      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(execution.run.error, undefined);
      assert.strictEqual(bus.historyOf("execution.run.cancelled").length, 1);
      assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
    });

    it("cancels a mid-run capability node through the abort gate", async () => {
      const gate = finiteDeferred<State>();
      const blocked: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.blocked",
        run: async (input) => {
          await gate.promise;
          return input.state;
        },
      };
      const registries = new RegistryPair("cap.blocked", blocked);
      const bus = new EventBus();
      const types: string[] = [];
      bus.onAny((event) => types.push(event.type));
      const controller = new AbortController();
      const nodeStarted = new Promise<void>((resolve) => bus.once("execution.node.started", () => resolve()));
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });

      const running = executor.execute(
        versionOf([new Node({ id: "b", type: "primitive", capabilityId: "cap.blocked" })]),
        { id: "blocked", signal: controller.signal, eventBus: bus }
      );

      await nodeStarted;
      controller.abort();
      gate.resolve(new State({ schema: schema(), value: {} }));

      const execution = await running;
      assert.strictEqual(execution.status, "cancelled");
      assert.strictEqual(execution.run.error, undefined);
      assert.deepStrictEqual(types, ["execution.run.started", "execution.node.started", "execution.run.cancelled"]);
    });
  });

  describe("isolation", () => {
    it("keeps two runs isolated through the capability path", async () => {
      const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
        capabilityId: "cap.tag",
        run: async (input) => input.state.withValue("handled", `tagged:${input.state.get<string>("tag")}`),
      };
      const registries = new RegistryPair("cap.tag", handler);
      const executor = new Executor({ capabilityRegistry: registries.capabilities, capabilityHandlerRegistry: registries.handlers });
      const version = versionOf([new Node({ id: "t", type: "primitive", capabilityId: "cap.tag" })]);

      const first = await executor.execute(version, {
        id: "iso-1",
        initialState: new State({ schema: version.stateSchema, value: { tag: "one" } }),
      });
      const second = await executor.execute(version, {
        id: "iso-2",
        initialState: new State({ schema: version.stateSchema, value: { tag: "two" } }),
      });

      assert.strictEqual(((first.run.result?.finalState) as State).get("handled"), "tagged:one");
      assert.strictEqual(((second.run.result?.finalState) as State).get("handled"), "tagged:two");
    });
  });
});