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
  RetryPolicy,
  State,
  StateSchema,
  type CapabilityHandler,
  type SchemaField,
} from "../../src/kernel/index.js";
import {
  Executor,
  FileRunStore,
  MemoryArtifactStore,
  Runtime,
  RUN_INTERRUPTED_ERROR,
  fromStoredPipelineVersion,
  toStoredPipelineVersion,
  type CapabilityExecutionContext,
  type CapabilityNodeInput,
  type NodeAction,
  type ResourceResolver,
  type StoredNodeRun,
  type StoredRun,
} from "../../src/runtime/index.js";
import { parseStoredRun } from "../../src/runtime/persistence/RunStore.js";

const tempDirs: string[] = [];

function tmpdirPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sprintdesk-retry-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "retry", fields: Object.assign({ count: { type: "number", required: false } }, fields) });
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes, edges: edges.map(([from, to]) => ({ from, to })) }),
    stateSchema: schema(),
  });
}

function counterAction(type = "counter"): NodeAction {
  return { type, run: async ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1) };
}

function flakyAction(type: string, failuresBeforeSuccess: number, message = "flaky boom"): NodeAction {
  let calls = 0;
  return {
    type,
    run: async ({ state }) => {
      calls += 1;
      if (calls <= failuresBeforeSuccess) {
        throw new Error(message);
      }
      return state.withValue("count", (state.get<number>("count") ?? 0) + 1);
    },
  };
}

function alwaysFailAction(type: string, message = "irrecoverable"): NodeAction {
  return {
    type,
    run: async () => {
      throw new Error(message);
    },
  };
}

function gateAction(type: string): { readonly action: NodeAction; readonly release: (value: State) => void } {
  let release!: (value: State) => void;
  const gate = new Promise<State>((resolve) => {
    release = resolve;
  });
  return { action: { type, run: async ({ state }) => gate }, release };
}

function registriesFor(
  capabilityId: string,
  handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>
): {
  readonly capabilities: CapabilityRegistry;
  readonly handlers: CapabilityHandlerRegistry;
} {
  const capabilities = new CapabilityRegistry();
  capabilities.register(new Capability({ id: capabilityId, type: "capability", version: 1 }));
  const handlers = new CapabilityHandlerRegistry();
  handlers.register(handler);
  return { capabilities, handlers };
}

function resourceOf(id: string): Resource {
  return new Resource({ id, type: "test-resource", version: "1", metadata: {} });
}

function nodeRun(
  nodeId: string,
  nodeType: string,
  status: StoredNodeRun["status"],
  patch: Partial<Omit<StoredNodeRun, "nodeId" | "nodeType" | "status">> = {}
): StoredNodeRun {
  return { nodeId, nodeType, status, ...patch };
}

function seededRun(
  id: string,
  status: StoredRun["status"],
  nodes: StoredNodeRun[],
  patch: Partial<Omit<StoredRun, "id" | "status" | "nodes">> = {}
): StoredRun {
  return { id, status, nodes, startedAt: 100, ...patch };
}

describe("runtime retry policy validation", () => {
  it("requires an integer maxAttempts >= 1", () => {
    assert.throws(() => new RetryPolicy({ maxAttempts: 0 }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    assert.throws(() => new RetryPolicy({ maxAttempts: -1 }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    assert.throws(() => new RetryPolicy({ maxAttempts: 1.5 }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    assert.throws(() => new RetryPolicy({ maxAttempts: "2" as unknown as number }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    assert.doesNotThrow(() => new RetryPolicy({ maxAttempts: 1 }));
    assert.strictEqual(new RetryPolicy({ maxAttempts: 3 }).maxAttempts, 3);
  });

  it("requires delayMs to be a finite number >= 0", () => {
    assert.throws(() => new RetryPolicy({ maxAttempts: 2, delayMs: -5 }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    assert.throws(() => new RetryPolicy({ maxAttempts: 2, delayMs: Number.NaN }), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");
    const policy = new RetryPolicy({ maxAttempts: 2, delayMs: 0 });
    assert.strictEqual(policy.delayMs, 0);
    const implicit = new RetryPolicy({ maxAttempts: 2 });
    assert.strictEqual(implicit.delayMs, undefined);
  });

  it("is immutable", () => {
    const policy = new RetryPolicy({ maxAttempts: 3, delayMs: 10 });
    assert.ok(Object.isFrozen(policy));
    assert.throws(() => {
      (policy as { maxAttempts: number }).maxAttempts = 5;
    });
  });

  it("declares the retry policy on a node", () => {
    const policy = new RetryPolicy({ maxAttempts: 3, delayMs: 10 });
    const node = new Node({ id: "a", type: "t", retryPolicy: policy });
    assert.strictEqual(node.retryPolicy, policy);
    const fromOptions = new Node({ id: "b", type: "t", retryPolicy: { maxAttempts: 2 } });
    assert.ok(fromOptions.retryPolicy instanceof RetryPolicy);
    assert.strictEqual(fromOptions.retryPolicy?.maxAttempts, 2);
    assert.ok(Object.isFrozen(node));
  });

  it("rejects an invalid retry policy on a node", () => {
    assert.throws(
      () => new Node({ id: "a", type: "t", retryPolicy: { maxAttempts: 0 } }),
      (e) => e instanceof DomainError && e.code === "INVALID_INPUT"
    );
    assert.throws(
      () => new Node({ id: "a", type: "t", retryPolicy: { maxAttempts: 2, delayMs: -1 } }),
      (e) => e instanceof DomainError && e.code === "INVALID_INPUT"
    );
  });

  it("treats maxAttempts 1 as retry disabled", async () => {
    const bus = new EventBus();
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 1 } })]);
    const execution = await new Executor({ actions: [flakyAction("boom", 2)] }).execute(version, { id: "no-retry", eventBus: bus });

    assert.strictEqual(execution.status, "failed");
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.status, "failed");
    assert.strictEqual(nodeRun?.attempts.length, 1);
    assert.strictEqual(nodeRun?.attempts[0]?.status, "failed");
    assert.strictEqual(bus.historyOf("execution.node.attempt.started").length, 0);
    assert.strictEqual(bus.historyOf("execution.node.retry.scheduled").length, 0);
  });
});

describe("runtime successful retry", () => {
  it("succeeds on a retry after a first failure", async () => {
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 2 } })]);
    const execution = await new Executor({ actions: [flakyAction("flaky", 1)] }).execute(version, { id: "retry-ok" });

    assert.strictEqual(execution.status, "succeeded");
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.status, "succeeded");
    assert.strictEqual(nodeRun?.attempts.length, 2);
    assert.strictEqual(nodeRun?.attempts[0]?.status, "failed");
    assert.strictEqual(nodeRun?.attempts[1]?.status, "succeeded");
    assert.strictEqual(nodeRun?.currentAttempt, 2);
  });

  it("succeeds after several retries", async () => {
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 4 } })]);
    const execution = await new Executor({ actions: [flakyAction("flaky", 3)] }).execute(version, { id: "retry-many" });

    assert.strictEqual(execution.status, "succeeded");
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.attempts.length, 4);
    assert.deepStrictEqual(nodeRun?.attempts.map((a) => a.status), ["failed", "failed", "failed", "succeeded"]);
  });

  it("does not advance state with failed attempts", async () => {
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 4 } })]);
    const execution = await new Executor({ actions: [flakyAction("flaky", 2)] }).execute(version, { id: "state-atomic" });

    assert.strictEqual(execution.status, "succeeded");
    const finalState = execution.run.result?.finalState as State;
    assert.strictEqual(finalState.get("count"), 1);
    assert.strictEqual(execution.nodes.get("a")?.attempts.length, 3);
  });

  it("waits for the configured delay between attempts", async () => {
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 3, delayMs: 30 } })]);
    const started = Date.now();
    const execution = await new Executor({ actions: [flakyAction("flaky", 2)] }).execute(version, { id: "delayed" });
    const elapsed = Date.now() - started;

    assert.strictEqual(execution.status, "succeeded");
    assert.ok(elapsed >= 55, `expected two 30ms delays, elapsed ${elapsed}ms`);
  });

  it("emits attempt and retry events in order", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event) => types.push(event.type));
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 2, delayMs: 10 } })]);
    const execution = await new Executor({ actions: [flakyAction("flaky", 1)] }).execute(version, { id: "events", eventBus: bus });

    assert.strictEqual(execution.status, "succeeded");
    assert.deepStrictEqual(types, [
      "execution.run.started",
      "execution.node.started",
      "execution.node.attempt.started",
      "execution.node.attempt.failed",
      "execution.node.retry.scheduled",
      "execution.node.attempt.started",
      "execution.node.finished",
      "execution.run.finished",
    ]);
    const scheduled = bus.historyOf("execution.node.retry.scheduled")[0];
    assert.strictEqual(scheduled?.payload.attempt, 2);
    assert.strictEqual(scheduled?.payload.delayMs, 10);
  });

  it("lets downstream nodes continue after a retrying node succeeds", async () => {
    const version = versionOf(
      [new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 2 } }), new Node({ id: "b", type: "next" })],
      [["a", "b"]]
    );
    const execution = await new Executor({ actions: [flakyAction("flaky", 1), counterAction("next")] }).execute(version, {
      id: "flow",
    });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(execution.nodes.get("a")?.status, "succeeded");
    assert.strictEqual(execution.nodes.get("b")?.status, "succeeded");
    const finalState = execution.run.result?.finalState as State;
    assert.strictEqual(finalState.get("count"), 2);
  });
});

describe("runtime exhausted retry", () => {
  it("fails the run when all attempts fail", async () => {
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3 } })]);
    const execution = await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, { id: "exhausted" });

    assert.strictEqual(execution.status, "failed");
    assert.strictEqual(execution.nodes.get("a")?.status, "failed");
    assert.strictEqual(execution.nodes.get("a")?.attempts.length, 3);
    assert.deepStrictEqual(execution.nodes.get("a")?.attempts.map((a) => a.status), ["failed", "failed", "failed"]);
  });

  it("surfaces the final attempt error on the node", async () => {
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3 } })]);
    const execution = await new Executor({ actions: [alwaysFailAction("boom", "kaboom")] }).execute(version, { id: "err" });

    assert.match(execution.nodes.get("a")?.error ?? "", /kaboom/);
    assert.match(execution.nodes.get("a")?.attempts[2]?.error ?? "", /kaboom/);
    assert.match(execution.run.error ?? "", /kaboom/);
  });

  it("records exactly maxAttempts attempts on exhaustion", async () => {
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 5 } })]);
    const execution = await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, { id: "count" });

    assert.strictEqual(execution.nodes.get("a")?.attempts.length, 5);
  });

  it("leaves the run result unset on exhaustion", async () => {
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 2 } })]);
    const execution = await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, { id: "no-result" });

    assert.strictEqual(execution.status, "failed");
    assert.strictEqual(execution.run.result, undefined);
  });

  it("leaves downstream nodes queued when retries are exhausted", async () => {
    const version = versionOf(
      [new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 2 } }), new Node({ id: "b", type: "next" })],
      [["a", "b"]]
    );
    const execution = await new Executor({ actions: [alwaysFailAction("boom"), counterAction("next")] }).execute(version, { id: "down" });

    assert.strictEqual(execution.status, "failed");
    assert.strictEqual(execution.nodes.get("a")?.status, "failed");
    assert.strictEqual(execution.nodes.get("b")?.status, "queued");
  });
});

describe("runtime retry events", () => {
  it("emits attempt.started for every attempt", async () => {
    const bus = new EventBus();
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3 } })]);
    await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, { id: "ev-start", eventBus: bus });

    assert.strictEqual(bus.historyOf("execution.node.attempt.started").length, 3);
    assert.deepStrictEqual(
      bus.historyOf("execution.node.attempt.started").map((event) => event.payload.attempt),
      [1, 2, 3]
    );
  });

  it("emits attempt.failed for every failed attempt", async () => {
    const bus = new EventBus();
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3 } })]);
    await new Executor({ actions: [alwaysFailAction("boom", "no")] }).execute(version, { id: "ev-fail", eventBus: bus });

    const failed = bus.historyOf("execution.node.attempt.failed");
    assert.strictEqual(failed.length, 3);
    assert.deepStrictEqual(failed.map((event) => event.payload.attempt), [1, 2, 3]);
    assert.match(String(failed[0]?.payload.error ?? ""), /no/);
  });

  it("emits retry.scheduled once per retry, not for the final attempt", async () => {
    const bus = new EventBus();
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3 } })]);
    await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, { id: "ev-sched", eventBus: bus });

    const scheduled = bus.historyOf("execution.node.retry.scheduled");
    assert.strictEqual(scheduled.length, 2);
    assert.deepStrictEqual(scheduled.map((event) => event.payload.attempt), [2, 3]);
    assert.strictEqual(bus.historyOf("execution.node.failed").length, 1);
  });

  it("emits node.finished exactly once after a successful retry", async () => {
    const bus = new EventBus();
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 3 } })]);
    const execution = await new Executor({ actions: [flakyAction("flaky", 2)] }).execute(version, { id: "ev-fin", eventBus: bus });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 1);
    assert.strictEqual(bus.historyOf("execution.node.failed").length, 0);
  });

  it("does not emit retry events for a default single-attempt node", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAny((event) => types.push(event.type));
    const version = versionOf([new Node({ id: "a", type: "counter" })]);
    const execution = await new Executor({ actions: [counterAction()] }).execute(version, { id: "ev-none", eventBus: bus });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(bus.historyOf("execution.node.attempt.started").length, 0);
    assert.strictEqual(bus.historyOf("execution.node.attempt.failed").length, 0);
    assert.strictEqual(bus.historyOf("execution.node.retry.scheduled").length, 0);
    assert.deepStrictEqual(types, [
      "execution.run.started",
      "execution.node.started",
      "execution.node.finished",
      "execution.run.finished",
    ]);
  });
});

describe("runtime retry cancellation", () => {
  it("cancels a node whose attempt is still running", async () => {
    const bus = new EventBus();
    const controller = new AbortController();
    const gated = gateAction("gated");
    const version = versionOf([new Node({ id: "a", type: "gated", retryPolicy: { maxAttempts: 2, delayMs: 10 } })]);
    const attemptStarted = new Promise<void>((resolve) => bus.once("execution.node.attempt.started", () => resolve()));

    const running = new Executor({ actions: [gated.action] }).execute(version, {
      id: "cancel-run",
      signal: controller.signal,
      eventBus: bus,
    });

    await attemptStarted;
    controller.abort();
    gated.release(new State({ schema: version.stateSchema, value: {} }));

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.status, "cancelled");
    assert.strictEqual(nodeRun?.attempts.length, 1);
    assert.strictEqual(nodeRun?.attempts[0]?.status, "cancelled");
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
  });

  it("cancels a node while it waits between retries", async () => {
    const bus = new EventBus();
    const controller = new AbortController();
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 3, delayMs: 200 } })]);
    const failedOnce = new Promise<void>((resolve) => bus.once("execution.node.attempt.failed", () => resolve()));

    const running = new Executor({ actions: [flakyAction("flaky", 1)] }).execute(version, {
      id: "cancel-wait",
      signal: controller.signal,
      eventBus: bus,
    });

    await failedOnce;
    setTimeout(() => controller.abort(), 30);

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.status, "cancelled");
    assert.strictEqual(nodeRun?.attempts.length, 1);
    assert.strictEqual(nodeRun?.attempts[0]?.status, "failed");
  });

  it("cancels immediately before a retry begins without starting another attempt", async () => {
    const bus = new EventBus();
    const controller = new AbortController();
    bus.once("execution.node.attempt.failed", () => controller.abort());
    const version = versionOf([new Node({ id: "a", type: "boom", retryPolicy: { maxAttempts: 3, delayMs: 1000 } })]);
    const execution = await new Executor({ actions: [alwaysFailAction("boom")] }).execute(version, {
      id: "cancel-before",
      signal: controller.signal,
      eventBus: bus,
    });

    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.run.error, undefined);
    const nodeRun = execution.nodes.get("a");
    assert.strictEqual(nodeRun?.status, "cancelled");
    assert.strictEqual(nodeRun?.attempts.length, 1);
    assert.strictEqual(bus.historyOf("execution.node.attempt.started").length, 1);
    assert.strictEqual(bus.historyOf("execution.node.attempt.failed").length, 1);
  });

  it("records the running attempt as cancelled, not failed", async () => {
    const controller = new AbortController();
    const gated = gateAction("gated");
    const version = versionOf([new Node({ id: "a", type: "gated", retryPolicy: { maxAttempts: 2 } })]);
    const bus = new EventBus();
    const attemptStarted = new Promise<void>((resolve) => bus.once("execution.node.attempt.started", () => resolve()));

    const running = new Executor({ actions: [gated.action] }).execute(version, {
      id: "cancel-history",
      signal: controller.signal,
      eventBus: bus,
    });

    await attemptStarted;
    controller.abort();
    gated.release(new State({ schema: version.stateSchema, value: {} }));

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.nodes.get("a")?.attempts[0]?.status, "cancelled");
    assert.strictEqual(execution.nodes.get("a")?.attempts[0]?.error, undefined);
  });

  it("emits no finished events for a cancelled retrying node", async () => {
    const bus = new EventBus();
    const controller = new AbortController();
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 3, delayMs: 200 } })]);
    const failedOnce = new Promise<void>((resolve) => bus.once("execution.node.attempt.failed", () => resolve()));

    const running = new Executor({ actions: [flakyAction("flaky", 1)] }).execute(version, {
      id: "cancel-fin",
      signal: controller.signal,
      eventBus: bus,
    });

    await failedOnce;
    setTimeout(() => controller.abort(), 30);

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.finished").length, 0);
    assert.strictEqual(bus.historyOf("execution.run.failed").length, 0);
  });
});

describe("runtime retry with capabilities and resources", () => {
  function flakyCapHandler(capabilityId: string, failuresBeforeSuccess: number, message = "cap boom") {
    let calls = 0;
    return {
      capabilityId,
      run: async ({ state }: CapabilityNodeInput): Promise<State> => {
        calls += 1;
        if (calls <= failuresBeforeSuccess) {
          throw new Error(message);
        }
        return state.withValue("count", (state.get<number>("count") ?? 0) + 1);
      },
    };
  }

  it("retries a node backed by a capability handler", async () => {
    const handler = flakyCapHandler("cap.flaky", 2);
    const { capabilities, handlers } = registriesFor("cap.flaky", handler);
    const version = versionOf([
      new Node({ id: "a", type: "primitive", capabilityId: "cap.flaky", retryPolicy: { maxAttempts: 3 } }),
    ]);
    const execution = await new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }).execute(version, { id: "cap-retry" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(execution.nodes.get("a")?.attempts.length, 3);
    assert.deepStrictEqual(execution.nodes.get("a")?.attempts.map((a) => a.status), ["failed", "failed", "succeeded"]);
    const finalState = execution.run.result?.finalState as State;
    assert.strictEqual(finalState.get("count"), 1);
  });

  it("keeps failed capability attempts off the state and result", async () => {
    const handler = flakyCapHandler("cap.state", 2);
    const { capabilities, handlers } = registriesFor("cap.state", handler);
    const version = versionOf([
      new Node({ id: "a", type: "primitive", capabilityId: "cap.state", retryPolicy: { maxAttempts: 3 } }),
    ]);
    const execution = await new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }).execute(version, { id: "cap-state" });

    assert.strictEqual(execution.status, "succeeded");
    const finalState = execution.run.result?.finalState as State;
    assert.strictEqual(finalState.get("count"), 1);
  });

  it("resolves resources for every attempt", async () => {
    let handlerCalls = 0;
    const handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> = {
      capabilityId: "cap.res",
      run: async ({ state }: CapabilityNodeInput): Promise<State> => {
        handlerCalls += 1;
        if (handlerCalls < 3) {
          throw new Error("res boom");
        }
        return state.withValue("count", 1);
      },
    };
    const { capabilities, handlers } = registriesFor("cap.res", handler);
    let resolverCalls = 0;
    const resolver: ResourceResolver = {
      resolve: async (reference) => {
        resolverCalls += 1;
        return resourceOf(reference.resourceId);
      },
    };
    const executor = new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers, resourceResolver: resolver });
    const version = versionOf([
      new Node({
        id: "a",
        type: "primitive",
        capabilityId: "cap.res",
        resourceReferences: [{ resourceId: "db" }],
        retryPolicy: { maxAttempts: 3 },
      }),
    ]);
    const execution = await executor.execute(version, { id: "resolves" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(resolverCalls, 3);
    assert.strictEqual(execution.nodes.get("a")?.attempts.length, 3);
  });

  it("stores artifacts only from a successful attempt", async () => {
    const artifacts = new MemoryArtifactStore();
    const version = versionOf([new Node({ id: "a", type: "art", retryPolicy: { maxAttempts: 3 } })]);
    let calls = 0;
    const action: NodeAction = {
      type: "art",
      run: ({ state, artifacts: emit }) => {
        calls += 1;
        if (calls < 3) {
          throw new Error("art boom");
        }
        emit.emit({ id: "key", type: "report", name: "artifact-key", ref: { kind: "content", content: "value" } });
        return state.withValue("count", 1);
      },
    };
    const execution = await new Executor({ actions: [action], artifactStore: artifacts }).execute(version, { id: "artifacts" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(artifacts.get("key")?.ref, { kind: "content", content: "value" });
  });

  it("records failed capability attempts on the node", async () => {
    const handler = flakyCapHandler("cap.still", 1, "still flaky");
    const { capabilities, handlers } = registriesFor("cap.still", handler);
    const version = versionOf([
      new Node({ id: "a", type: "primitive", capabilityId: "cap.still", retryPolicy: { maxAttempts: 3 } }),
    ]);
    const execution = await new Executor({ capabilityRegistry: capabilities, capabilityHandlerRegistry: handlers }).execute(version, { id: "cap-record" });

    assert.strictEqual(execution.status, "succeeded");
    const attempt = execution.nodes.get("a")?.attempts[0];
    assert.strictEqual(attempt?.status, "failed");
    assert.match(attempt?.error ?? "", /still flaky/);
  });
});

describe("runtime retry persistence", () => {
  it("persists attempt history and retry policy through the runtime", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    const version = versionOf([new Node({ id: "a", type: "flaky", retryPolicy: { maxAttempts: 3, delayMs: 5 } })]);
    const runtime = new Runtime({ executor: new Executor({ actions: [flakyAction("flaky", 1)] }), runStore: store });
    const run = await runtime.execute(version, { id: "persist" });

    assert.strictEqual(run.status, "succeeded");
    const stored = store.get("persist");
    assert.ok(stored);
    assert.strictEqual(stored.status, "succeeded");
    const node = stored.nodes?.find((n) => n.nodeId === "a");
    assert.ok(node);
    assert.strictEqual(node.retryPolicy?.maxAttempts, 3);
    assert.strictEqual(node.retryPolicy?.delayMs, 5);
    assert.strictEqual(node.currentAttempt, 2);
    assert.strictEqual(node?.attempts?.length, 2);
    assert.strictEqual(node.attempts?.[0]?.attempt, 1);
    assert.strictEqual(node.attempts?.[0]?.status, "failed");
    assert.strictEqual(node.attempts?.[1]?.status, "succeeded");
  });

  it("round-trips the retry policy through stored pipeline versions", async () => {
    const version = versionOf([new Node({ id: "a", type: "t", retryPolicy: { maxAttempts: 4, delayMs: 20 } })]);
    const stored = toStoredPipelineVersion(version);
    assert.strictEqual(stored.graph.nodes[0]?.retryPolicy?.maxAttempts, 4);
    assert.strictEqual(stored.graph.nodes[0]?.retryPolicy?.delayMs, 20);
    const restored = fromStoredPipelineVersion(stored);
    const node = restored.graph.nodes.get("a");
    assert.ok(node?.retryPolicy instanceof RetryPolicy);
    assert.strictEqual(node?.retryPolicy?.maxAttempts, 4);
  });

  it("omits retry fields from legacy stored node runs", async () => {
    const run = nodeRun("a", "counter", "succeeded", { startedAt: 0, finishedAt: 10 });
    const stored = seededRun("legacy", "succeeded", [run], { finishedAt: 20 });
    const restored = parseStoredRun(stored);
    const node = restored.nodes?.find((n) => n.nodeId === "a");
    assert.ok(node);
    assert.strictEqual(node.currentAttempt, undefined);
    assert.strictEqual(node.attempts, undefined);
    assert.strictEqual(node.retryPolicy, undefined);
  });

  it("rejects malformed persisted attempt data", () => {
    const badAttempt = nodeRun("a", "t", "succeeded", {
      attempts: [{ attempt: 0, status: "failed" }] as unknown as StoredNodeRun["attempts"],
    });
    const badAttemptsRun = seededRun("bad", "succeeded", [badAttempt]);
    assert.throws(() => parseStoredRun(badAttemptsRun), (e) => e instanceof DomainError && e.code === "INVALID_INPUT");

    const badPolicy = nodeRun("a", "t", "succeeded", {
      retryPolicy: { maxAttempts: 0 } as StoredNodeRun["retryPolicy"],
    });
    assert.throws(
      () => parseStoredRun(seededRun("bad2", "succeeded", [badPolicy])),
      (e) => e instanceof DomainError && e.code === "INVALID_INPUT"
    );

    const badStatus = nodeRun("a", "t", "succeeded", {
      attempts: [{ attempt: 1, startedAt: 100, status: "bogus" }] as unknown as StoredNodeRun["attempts"],
    });
    assert.throws(
      () => parseStoredRun(seededRun("bad3", "succeeded", [badStatus])),
      (e) => e instanceof DomainError && e.code === "INVALID_INPUT"
    );
  });
});

describe("runtime retry restart recovery", () => {
  it("recovers an interrupted retrying node as cancelled while keeping attempt history", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    const retryPolicy = { maxAttempts: 3, delayMs: 10 };
    store.save(
      seededRun("int", "running", [
        nodeRun("a", "flaky", "running", {
          startedAt: 110,
          retryPolicy,
          currentAttempt: 2,
          attempts: [
            { attempt: 1, status: "failed", startedAt: 110, finishedAt: 115, error: "flaky boom" },
            { attempt: 2, status: "running", startedAt: 125 },
          ],
        }),
      ])
    );

    const runtime = new Runtime({ executor: new Executor({ actions: [flakyAction("flaky", 1)] }), runStore: store });

    const info = runtime.status("int");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
    const node = info.nodes.find((n) => n.nodeId === "a");
    assert.strictEqual(node?.status, "cancelled");
    assert.strictEqual(node?.currentAttempt, 2);
    assert.deepStrictEqual(node?.attempts?.map((a) => a.status), ["failed", "running"]);
    assert.strictEqual(node?.retryPolicy?.maxAttempts, 3);
    assert.match(node?.attempts?.[0]?.error ?? "", /flaky boom/);
  });

  it("does not re-run the recovered run on a subsequent restart", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    const retryPolicy = { maxAttempts: 3, delayMs: 10 };
    store.save(
      seededRun("int", "running", [
        nodeRun("a", "flaky", "running", {
          startedAt: 110,
          retryPolicy,
          currentAttempt: 2,
          attempts: [
            { attempt: 1, status: "failed", startedAt: 110, finishedAt: 115, error: "boom" },
            { attempt: 2, status: "running", startedAt: 125 },
          ],
        }),
      ])
    );

    let calls = 0;
    const action: NodeAction = { type: "flaky", run: async () => { calls += 1; return new State({ schema: schema(), value: {} }); } };
    const executor = new Executor({ actions: [action] });
    new Runtime({ executor, runStore: store });
    const second = new Runtime({ executor, runStore: store });

    assert.strictEqual(calls, 0);
    const info = second.status("int");
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, RUN_INTERRUPTED_ERROR);
    assert.strictEqual(info.nodes.find((n) => n.nodeId === "a")?.status, "cancelled");
    assert.strictEqual(info.nodes.find((n) => n.nodeId === "a")?.attempts?.length, 2);
  });
});