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
  Dispatcher,
  Executor,
  FileRunStore,
  FileScheduleStore,
  MemoryRunStore,
  MemoryScheduleStore,
  PipelineEngine,
  Runtime,
  Schedule,
  Scheduler,
  toStoredSchedule,
  type NodeAction,
} from "../../src/runtime/index.js";

const tempDirs: string[] = [];

function tmpdirPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sprintdesk-persist-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "persistence", fields });
}

function counterVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes: [new Node({ id: "counter", type: "counter" })] }),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function failingVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes: [new Node({ id: "boom", type: "boom" })] }),
    stateSchema: schema({}),
  });
}

function counterAction(): NodeAction {
  return {
    type: "counter",
    run: ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
  };
}

function boomAction(): NodeAction {
  return {
    type: "boom",
    run: () => {
      throw new Error("boom");
    },
  };
}

async function waitForStatus(runtime: Runtime, id: string, status: string, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.status(id).status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`run "${id}" did not reach status "${status}" in time`);
}

async function waitForDispatchStatus(dispatcher: Dispatcher, id: string, status: string, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (dispatcher.status(id).status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`dispatch "${id}" did not reach status "${status}" in time`);
}

describe("persistence/MemoryRunStore", () => {
  it("saves, gets, lists, and deletes", () => {
    const store = new MemoryRunStore();
    store.save({ id: "a", status: "succeeded", startedAt: 1 });
    assert.deepStrictEqual(store.get("a"), { id: "a", status: "succeeded", startedAt: 1 });
    assert.strictEqual(store.get("nope"), null);
    assert.strictEqual(store.list().length, 1);
    store.delete("a");
    assert.strictEqual(store.list().length, 0);
  });
});

describe("persistence/MemoryScheduleStore", () => {
  it("saves, gets, lists, and deletes", () => {
    const store = new MemoryScheduleStore();
    const schedule = new Schedule({ id: "daily", pipelineId: "p", version: 3 });
    const stored = toStoredSchedule(schedule);
    store.save(stored);
    assert.deepStrictEqual(store.get("daily"), stored);
    assert.strictEqual(store.get("nope"), null);
    assert.strictEqual(store.list().length, 1);
    store.delete("daily");
    assert.strictEqual(store.list().length, 0);
  });
});

describe("persistence/FileRunStore", () => {
  it("creates a missing directory and treats a missing file as empty", () => {
    const dir = join(tmpdirPath(), "nested", "deep");
    const store = new FileRunStore({ filePath: join(dir, "runs.json") });
    assert.ok(existsSync(dir));
    assert.strictEqual(store.list().length, 0);
    assert.strictEqual(store.get("nope"), null);
  });

  it("round-trips runs to disk", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const store = new FileRunStore({ filePath });
    store.save({ id: "r1", status: "succeeded", startedAt: 111, finishedAt: 222 });
    store.save({ id: "r2", status: "failed", error: "boom" });

    const reloaded = new FileRunStore({ filePath });
    assert.strictEqual(reloaded.list().length, 2);
    assert.deepStrictEqual(reloaded.get("r1"), { id: "r1", status: "succeeded", startedAt: 111, finishedAt: 222 });
    assert.deepStrictEqual(reloaded.get("r2"), { id: "r2", status: "failed", error: "boom" });

    reloaded.delete("r1");
    const reloadedAgain = new FileRunStore({ filePath });
    assert.strictEqual(reloadedAgain.get("r1"), null);
    assert.strictEqual(reloadedAgain.get("r2")?.error, "boom");
  });

  it("rejects malformed JSON clearly", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    writeFileSync(filePath, "{not json", "utf8");
    assert.throws(() => new FileRunStore({ filePath }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.ok((error as DomainError).message.includes("Malformed run store file"));
      return true;
    });
  });

  it("rejects a file without a runs array", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    writeFileSync(filePath, JSON.stringify({ foo: 1 }), "utf8");
    assert.throws(() => new FileRunStore({ filePath }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.ok((error as DomainError).message.includes('"runs" array'));
      return true;
    });
  });

  it("rejects malformed run records clearly", () => {
    const filePath = join(tmpdirPath(), "runs.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, runs: [{ id: "x" }] }), "utf8");
    assert.throws(() => new FileRunStore({ filePath }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.ok((error as DomainError).message.includes("Malformed persisted run data"));
      return true;
    });
  });
});

describe("persistence/FileScheduleStore", () => {
  it("creates a missing directory and treats a missing file as empty", () => {
    const dir = join(tmpdirPath(), "nested", "deep");
    const store = new FileScheduleStore({ filePath: join(dir, "schedules.json") });
    assert.ok(existsSync(dir));
    assert.strictEqual(store.list().length, 0);
  });

  it("rejects malformed JSON clearly", () => {
    const filePath = join(tmpdirPath(), "schedules.json");
    writeFileSync(filePath, "not json", "utf8");
    assert.throws(() => new FileScheduleStore({ filePath }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.ok((error as DomainError).message.includes("Malformed schedule store file"));
      return true;
    });
  });

  it("rejects a schedule with an unknown trigger type", () => {
    const filePath = join(tmpdirPath(), "schedules.json");
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, schedules: [{ id: "s", pipelineId: "p", enabled: true, createdAt: 1, trigger: { type: "cron" } }] }),
      "utf8"
    );
    assert.throws(() => new FileScheduleStore({ filePath }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.ok((error as DomainError).message.includes("trigger.type"));
      return true;
    });
  });
});

describe("persistence across restart", () => {
  it("Runtime restores a persisted run after a fresh Runtime is created", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const executor = new Executor({ actions: [counterAction()] });
    const version = counterVersion();

    const first = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
    const runId = first.start(version);
    await waitForStatus(first, runId, "succeeded");

    const second = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
    const info = second.status(runId);
    assert.strictEqual(info.status, "succeeded");
    assert.ok(info.startedAt);
    assert.ok(info.finishedAt);
    assert.strictEqual(info.execution, undefined);
    assert.ok(second.runs().some((run) => run.id === runId));
  });

  it("Runtime restores the error of a previously failed run without live state", async () => {
    const filePath = join(tmpdirPath(), "runs.json");
    const executor = new Executor({ actions: [boomAction()] });

    const first = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
    const runId = first.start(failingVersion());
    await waitForStatus(first, runId, "failed");

    const second = new Runtime({ executor, runStore: new FileRunStore({ filePath }) });
    const info = second.status(runId);
    assert.strictEqual(info.status, "failed");
    assert.strictEqual(info.error, "boom");
    assert.strictEqual(info.execution, undefined);
  });

  it("Scheduler restores schedules after a fresh Scheduler is created", async () => {
    const filePath = join(tmpdirPath(), "schedules.json");
    const executor = new Executor({ actions: [counterAction()] });

    const firstRegistry = new PipelineRegistry();
    firstRegistry.register(new Pipeline({ id: "daily", name: "Daily", versions: [counterVersion()] }));
    const firstRuntime = new Runtime({ executor });
    const firstDispatcher = new Dispatcher({
      engine: new PipelineEngine(firstRegistry, firstRuntime),
      runtime: firstRuntime,
    });
    const firstScheduler = new Scheduler({
      dispatcher: firstDispatcher,
      scheduleStore: new FileScheduleStore({ filePath }),
    });
    firstScheduler.schedule({ id: "daily", pipelineId: "daily", trigger: { type: "interval", everyMs: 60000 }, createdAt: 42 });

    const secondRegistry = new PipelineRegistry();
    secondRegistry.register(new Pipeline({ id: "daily", name: "Daily", versions: [counterVersion()] }));
    const secondRuntime = new Runtime({ executor });
    const secondDispatcher = new Dispatcher({
      engine: new PipelineEngine(secondRegistry, secondRuntime),
      runtime: secondRuntime,
    });
    const secondScheduler = new Scheduler({
      dispatcher: secondDispatcher,
      scheduleStore: new FileScheduleStore({ filePath }),
    });
    const restored = secondScheduler.get("daily");
    assert.ok(restored);
    assert.deepStrictEqual(restored.trigger, { type: "interval", everyMs: 60000 });
    assert.strictEqual(restored.enabled, true);
    assert.strictEqual(restored.createdAt, 42);
    assert.strictEqual(restored.pipelineId, "daily");
    assert.strictEqual(restored.version, undefined);

    const dispatchId = secondScheduler.trigger("daily");
    await waitForDispatchStatus(secondDispatcher, dispatchId, "succeeded");
  });
});