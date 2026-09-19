import * as assert from "assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DomainError,
  EventBus,
  Graph,
  Node,
  NodeRun,
  PipelineVersion,
  State,
  StateSchema,
} from "../../src/kernel/index.js";
import { Executor, ExecutionCancelledError, type NodeAction, type NodeInput } from "../../src/runtime/Executor.js";
import { Runtime, type RunStatusInfo } from "../../src/runtime/Runtime.js";
import {
  FileRunStore,
  type StoredNodeRun,
  type StoredRun,
} from "../../src/runtime/index.js";
import { parseStoredRun, toStoredNodeRun } from "../../src/runtime/persistence/RunStore.js";

function schema(): StateSchema {
  return new StateSchema({ name: "node-run", fields: { counter: { type: "number", required: false } } });
}

function node(options: ConstructorParameters<typeof Node>[0]): Node {
  return new Node(options);
}

function versionOf(nodes: Node[], edges: Array<[string, string]> = []): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({
      nodes,
      edges: edges.map(([from, to]) => ({ from, to })),
    }),
    stateSchema: schema(),
  });
}

function buildVersion(...nodes: Node[]): PipelineVersion {
  return versionOf(nodes);
}

function makeAction(type: string, run: NodeAction["run"]): NodeAction {
  return { type, run };
}

function emitterAction(type: string): NodeAction {
  return makeAction(type, async ({ state }) => state.withValue("counter", (state.get<number>("counter") ?? 0) + 1));
}

function failingAction(type: string): NodeAction {
  return makeAction(type, async () => {
    throw new Error("oops");
  });
}

describe("kernel NodeRun", () => {
  it("starts queued and transitions through the full lifecycle", () => {
    const nodeRun = new NodeRun({ nodeId: "a", nodeType: "primitive" });
    assert.strictEqual(nodeRun.status, "queued");
    const started = nodeRun.start(1000);
    assert.strictEqual(started.status, "running");
    const succeeded = started.succeed(3, 2000);
    assert.strictEqual(succeeded.status, "succeeded");
    assert.strictEqual(succeeded.startedAt, 1000);
    assert.strictEqual(succeeded.finishedAt, 2000);
    assert.strictEqual(succeeded.stateVersion, 3);
  });

  it("rejects illegal transitions", () => {
    const nodeRun = new NodeRun({ nodeId: "a", nodeType: "primitive" });
    assert.throws(
      () => nodeRun.succeed(),
      (error) => error instanceof DomainError && error.code === "ILLEGAL_TRANSITION"
    );
  });

  it("supports fail and cancel with error payloads", () => {
    const failed = new NodeRun({ nodeId: "a", nodeType: "primitive", status: "running" }).fail("boom", 500);
    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.error, "boom");
    const cancelled = new NodeRun({ nodeId: "b", nodeType: "primitive" }).cancel(600);
    assert.strictEqual(cancelled.status, "cancelled");
    assert.strictEqual(cancelled.finishedAt, 600);
  });

  it("validates node identity", () => {
    assert.throws(() => new NodeRun({ nodeId: " ", nodeType: "x" }), /nodeId/);
    assert.throws(() => new NodeRun({ nodeId: "x", nodeType: "" }), /nodeType/);
  });
});

describe("Executor node-run lifecycle", () => {
  it("tracks every node to succeeded with the state version", async () => {
    const version = buildVersion(
      node({ id: "a", type: "inc" }),
      node({ id: "b", type: "inc" })
    );
    const execution = await new Executor({ actions: [emitterAction("inc")] }).execute(version, { id: "tracks" });

    assert.strictEqual(execution.status, "succeeded");
    assert.strictEqual(execution.nodes.size, 2);
    const a = execution.nodes.get("a");
    const b = execution.nodes.get("b");
    assert.strictEqual(a?.status, "succeeded");
    assert.strictEqual(b?.status, "succeeded");
    assert.ok((a?.stateVersion ?? 0) > 0);
    assert.ok((b?.stateVersion ?? 0) > a?.stateVersion!);
  });

  it("marks the failing node failed and emits node.failed", async () => {
    const version = buildVersion(node({ id: "a", type: "ok" }), node({ id: "b", type: "boom" }), node({ id: "c", type: "inc" }));
    const bus = new EventBus();
    const execution = await new Executor({ actions: [emitterAction("inc"), emitterAction("ok"), failingAction("boom")] }).execute(
      version,
      { id: "fails", eventBus: bus }
    );

    assert.strictEqual(execution.status, "failed");
    assert.strictEqual(execution.nodes.get("a")?.status, "succeeded");
    assert.strictEqual(execution.nodes.get("b")?.status, "failed");
    assert.match(execution.nodes.get("b")?.error ?? "", /oops/);
    assert.strictEqual(execution.nodes.get("c")?.status, "queued");
    assert.strictEqual(bus.historyOf("execution.node.failed").length, 1);
  });

  it("marks an abort-racing node cancelled and leaves the rest queued", async () => {
    const abortable = makeAction(
      "slow",
      ({ signal }: NodeInput) =>
        new Promise<State>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ExecutionCancelledError()), { once: true });
        })
    );
    const bus = new EventBus();
    const controller = new AbortController();
    const version = buildVersion(node({ id: "a", type: "slow" }), node({ id: "b", type: "inc" }));
    const nodeStarted = new Promise<void>((resolve) => bus.once("execution.node.started", () => resolve()));

    const running = new Executor({ actions: [abortable, emitterAction("inc")] }).execute(version, {
      id: "cancell",
      signal: controller.signal,
      eventBus: bus,
    });

    await nodeStarted;
    controller.abort();

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.nodes.get("a")?.status, "cancelled");
    assert.strictEqual(execution.nodes.get("b")?.status, "cancelled");
    assert.strictEqual(bus.historyOf("execution.node.cancelled").length, 1);
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
  });

  it("marks remaining queued nodes cancelled when aborted after completion", async () => {
    let resolveGate: ((state: State) => void) | undefined;
    const gate = new Promise<State>((resolve) => {
      resolveGate = resolve;
    });
    const blocked = makeAction("blocked", async () => gate);
    const version = buildVersion(node({ id: "a", type: "blocked" }), node({ id: "b", type: "inc" }), node({ id: "c", type: "inc" }));
    const bus = new EventBus();
    const controller = new AbortController();
    const nodeStarted = new Promise<void>((resolve) => bus.once("execution.node.started", () => resolve()));

    const running = new Executor({ actions: [blocked, emitterAction("inc")] }).execute(version, {
      id: "post",
      signal: controller.signal,
      eventBus: bus,
    });

    await nodeStarted;
    controller.abort();
    resolveGate?.(new State({ schema: schema(), value: {} }));

    const execution = await running;
    assert.strictEqual(execution.status, "cancelled");
    assert.strictEqual(execution.nodes.get("a")?.status, "cancelled");
    assert.strictEqual(execution.nodes.get("b")?.status, "cancelled");
    assert.strictEqual(execution.nodes.get("c")?.status, "cancelled");
    assert.strictEqual(bus.historyOf("execution.node.finished").length, 0);
  });

  it("rejects a schema-violating node as failed", async () => {
    const badAction = makeAction("bad", () => new State({ schema: new StateSchema({ name: "other" }), value: {} }));
    const version = buildVersion(node({ id: "a", type: "bad" }));
    const execution = await new Executor({ actions: [badAction] }).execute(version, { id: "schema" });
    assert.strictEqual(execution.status, "failed");
    assert.strictEqual(execution.nodes.get("a")?.status, "failed");
    assert.match(execution.nodes.get("a")?.error ?? "", /schema/i);
  });

  it("serializes node runs without runtime objects", () => {
    const nodeRun = new NodeRun({ nodeId: "a", nodeType: "primitive", status: "succeeded", stateVersion: 2, startedAt: 1, finishedAt: 2 });
    const stored = toStoredNodeRun(nodeRun);
    assert.deepStrictEqual(Object.keys(stored).sort(), ["error", "finishedAt", "nodeId", "nodeType", "startedAt", "stateVersion", "status"].sort());
    assert.strictEqual(stored.nodeId, "a");
    assert.strictEqual(stored.stateVersion, 2);
    for (const forbidden of ["handler", "resolver", "executor", "runtime", "abortcontroller", "signaling"]) {
      assert.ok(!JSON.stringify(stored).toLowerCase().includes(forbidden), `node run must not contain "${forbidden}"`);
    }
  });
});

describe("pipeline-run persistence", () => {
  it("parses legacy stored runs without pipeline/node fields", () => {
    const parsed = parseStoredRun({ id: "legacy", status: "succeeded" });
    assert.deepStrictEqual(parsed.nodes, undefined);
    assert.strictEqual(parsed.pipelineId, undefined);
  });

  it("rejects malformed node-run fields", () => {
    assert.throws(() => parseStoredRun({ id: "x", status: "succeeded", pipelineId: " " }), /Malformed persisted run data/);
    assert.throws(() => parseStoredRun({ id: "x", status: "succeeded", pipelineVersion: 0 }), /Malformed persisted run data/);
    assert.throws(
      () =>
        parseStoredRun({
          id: "x",
          status: "succeeded",
          nodes: [{ nodeId: "a", nodeType: "t", status: "bogus" }],
        }),
      /Malformed persisted run data/
    );
    assert.throws(
      () =>
        parseStoredRun({
          id: "x",
          status: "succeeded",
          nodes: [{ nodeId: "a", nodeType: "t", status: "succeeded", stateVersion: 0 }],
        }),
      /Malformed persisted run data/
    );
  });

  it("round-trips node runs through a file store", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprintdesk-runs-"));
    try {
      const filePath = join(dir, "runs.json");
      const store = new FileRunStore({ filePath });
      const stored: StoredRun = {
        id: "real",
        status: "failed",
        startedAt: 1,
        finishedAt: 2,
        error: "boom",
        pipelineId: "dev.example",
        pipelineVersion: 1,
        nodes: [
          { nodeId: "a", nodeType: "dev.log", status: "succeeded", stateVersion: 2 },
          { nodeId: "b", nodeType: "dev.boom", status: "failed", error: "boom" },
        ],
      };
      store.save(stored);

      const reloaded = new FileRunStore({ filePath });
      const restored = reloaded.get("real");
      assert.ok(restored);
      assert.strictEqual(restored.pipelineId, "dev.example");
      assert.strictEqual(restored.pipelineVersion, 1);
      assert.deepStrictEqual(restored.nodes, stored.nodes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Runtime pipeline-run tracking", () => {
  it("persists pipeline identity and node runs to the store", async () => {
    const executor = new Executor({ actions: [emitterAction("inc")] });
    const runtime = new Runtime({ executor });
    const version = buildVersion(node({ id: "a", type: "inc" }), node({ id: "b", type: "inc" }));

    const execution = await runtime.execute(version, { id: "pr", pipelineId: "dev.example" });
    assert.strictEqual(execution.status, "succeeded");

    const info = runtime.status("pr");
    assert.strictEqual(info.pipelineId, "dev.example");
    assert.strictEqual(info.pipelineVersion, 1);
    assert.strictEqual(info.nodes.length, 2);
    assert.deepStrictEqual(
      info.nodes.map((n) => n.status),
      ["succeeded", "succeeded"]
    );
  });

  it("restores pipeline identity and node runs after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sprintdesk-runtime-"));
    try {
      const filePath = join(dir, "runs.json");
      const executor = new Executor({ actions: [emitterAction("inc")] });
      const first = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
      const version = buildVersion(node({ id: "a", type: "inc" }));
      await first.execute(version, { id: "restart", pipelineId: "dev.example" });

      const second = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
      const restored = second.status("restart");
      assert.strictEqual(restored.pipelineId, "dev.example");
      assert.strictEqual(restored.pipelineVersion, 1);
      assert.strictEqual(restored.nodes[0]?.nodeId, "a");
      assert.strictEqual(restored.nodes[0]?.status, "succeeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces node runs from a failed execution", async () => {
    const runtime = new Runtime({ executor: new Executor({ actions: [failingAction("boom")] }) });
    const execution = await runtime.execute(buildVersion(node({ id: "a", type: "boom" })), { id: "failrun" });
    assert.strictEqual(execution.status, "failed");
    const info = runtime.status("failrun");
    assert.strictEqual(info.nodes[0]?.status, "failed");
    assert.match(info.nodes[0]?.error ?? "", /oops/);
  });

  it("keeps the pipeline id off runs started without one", async () => {
    const runtime = new Runtime({ executor: new Executor({ actions: [emitterAction("inc")] }) });
    await runtime.execute(buildVersion(node({ id: "a", type: "inc" })), { id: "anon" });
    const status: RunStatusInfo = runtime.status("anon");
    assert.strictEqual(status.pipelineId, undefined);
    assert.strictEqual(status.pipelineVersion, 1);
  });
});