import * as assert from "assert";
import {
  DomainError,
  EventBus,
  Graph,
  Node,
  Pipeline,
  PipelineRegistry,
  PipelineVersion,
  State,
  StateSchema,
} from "../../src/kernel/index.js";
import {
  Dispatcher,
  Executor,
  PipelineEngine,
  Runtime,
  Schedule,
  Scheduler,
  type DispatchStatus,
} from "../../src/runtime/index.js";
import type { NodeAction } from "../../src/runtime/Executor.js";

function schema(): StateSchema {
  return new StateSchema({ name: "scheduler", fields: { count: { type: "number", required: false } } });
}

function version(...types: string[]): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: new Graph({ nodes: types.map((type, index) => new Node({ id: `n${index}`, type })) }),
    stateSchema: schema(),
  });
}

function counterAction(type = "counter"): NodeAction {
  return {
    type,
    run: async ({ state }) => state.withValue("count", (state.get<number>("count") ?? 0) + 1),
  };
}

function boomAction(type = "boom"): NodeAction {
  return {
    type,
    run: async () => {
      throw new Error("boom");
    },
  };
}

interface SchedulerEnv {
  readonly registry: PipelineRegistry;
  readonly runtime: Runtime;
  readonly engine: PipelineEngine;
  readonly dispatcher: Dispatcher;
  readonly scheduler: Scheduler;
}

function schedulerWith(actions: readonly NodeAction[] = [counterAction()], eventBus?: EventBus): SchedulerEnv {
  const registry = new PipelineRegistry();
  const runtime = new Runtime({ executor: new Executor({ actions }) });
  const engine = new PipelineEngine(registry, runtime);
  const dispatcher = new Dispatcher({ engine, runtime });
  const scheduler = new Scheduler({ dispatcher, eventBus });
  return { registry, runtime, engine, dispatcher, scheduler };
}

function registerPipeline(env: SchedulerEnv, id: string, nodeTypes: readonly string[]): void {
  env.registry.register(new Pipeline({ id, name: id, versions: [version(...nodeTypes)] }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  dispatcher: Dispatcher,
  id: string,
  status: DispatchStatus,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (dispatcher.status(id).status === status) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for dispatch "${id}" to reach "${status}"`);
    }
    await delay(10);
  }
}

async function waitForDispatchCount(dispatcher: Dispatcher, expected: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    if (dispatcher.list().length >= expected) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for at least ${expected} dispatches (got ${dispatcher.list().length})`);
    }
    await delay(10);
  }
}

async function waitForAnyFailed(dispatcher: Dispatcher, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    if (dispatcher.list().some((entry) => entry.status === "failed")) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for a failed dispatch");
    }
    await delay(10);
  }
}

async function waitForRunId(dispatcher: Dispatcher, id: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  while (true) {
    const runId = dispatcher.status(id).runId;
    if (runId) {
      return runId;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for a run id on dispatch "${id}"`);
    }
    await delay(10);
  }
}

describe("Schedule", () => {
  it("creates an immutable schedule bound to a pipeline and optional version", () => {
    const schedule = new Schedule({ id: "daily", pipelineId: "p", version: 2, createdAt: 12345 });
    assert.strictEqual(schedule.id, "daily");
    assert.strictEqual(schedule.pipelineId, "p");
    assert.strictEqual(schedule.version, 2);
    assert.strictEqual(schedule.createdAt, 12345);
    assert.ok(Object.isFrozen(schedule));
    assert.strictEqual(schedule.toString(), "Schedule daily for p v2");

    const withoutVersion = new Schedule({ id: "latest", pipelineId: "p" });
    assert.strictEqual(withoutVersion.version, undefined);
    assert.strictEqual(withoutVersion.toString(), "Schedule latest for p");
  });

  it("uses the current epoch time as createdAt by default", () => {
    const before = Date.now();
    const schedule = new Schedule({ id: "now", pipelineId: "p" });
    assert.ok(schedule.createdAt >= before && schedule.createdAt <= Date.now());
  });

  it("rejects a blank id", () => {
    assert.throws(
      () => new Schedule({ id: "   ", pipelineId: "p" }),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("rejects a blank pipelineId", () => {
    assert.throws(
      () => new Schedule({ id: "daily", pipelineId: "  " }),
      (error) => error instanceof DomainError && error.message.includes("pipelineId")
    );
  });

  it("rejects an invalid version", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new Schedule({ id: "x", pipelineId: "p", version: bad }),
        (error) => error instanceof DomainError && error.message.includes("version")
      );
    }
  });

  it("defaults to a manual trigger and enabled", () => {
    const schedule = new Schedule({ id: "plain", pipelineId: "p" });
    assert.deepStrictEqual(schedule.trigger, { type: "manual" });
    assert.strictEqual(schedule.enabled, true);
  });

  it("keeps an interval trigger and validates it", () => {
    const schedule = new Schedule({ id: "every", pipelineId: "p", trigger: { type: "interval", everyMs: 10_000 } });
    assert.deepStrictEqual(schedule.trigger, { type: "interval", everyMs: 10_000 });
    for (const everyMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new Schedule({ id: "bad", pipelineId: "p", trigger: { type: "interval", everyMs } }),
        (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
      );
    }
  });

  it("keeps an explicit enabled flag", () => {
    const schedule = new Schedule({ id: "off", pipelineId: "p", enabled: false });
    assert.strictEqual(schedule.enabled, false);
  });

  it("keeps an event trigger and preserves its eventType", () => {
    const schedule = new Schedule({ id: "e", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });
    assert.deepStrictEqual(schedule.trigger, { type: "event", eventType: "dev.tick" });
  });

  it("holds an event trigger without an eventType", () => {
    const schedule = new Schedule({ id: "all", pipelineId: "p", trigger: { type: "event" } });
    assert.deepStrictEqual(schedule.trigger, { type: "event" });
  });

  it("rejects a blank eventType", () => {
    assert.throws(
      () => new Schedule({ id: "bad", pipelineId: "p", trigger: { type: "event", eventType: "   " } }),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });
});

describe("Scheduler", () => {
  it("registers a schedule and lists it", () => {
    const env = schedulerWith();
    const daily = env.scheduler.schedule({ id: "daily", pipelineId: "p" });
    assert.strictEqual(env.scheduler.list().length, 1);
    assert.strictEqual(env.scheduler.list()[0], daily);
    assert.strictEqual(env.scheduler.list()[0].pipelineId, "p");
  });

  it("generates an id when none is provided", () => {
    const env = schedulerWith();
    const schedule = env.scheduler.schedule({ pipelineId: "p" });
    assert.match(schedule.id, /^schedule-\d+$/);
    assert.strictEqual(schedule.pipelineId, "p");
  });

  it("rejects duplicate schedule ids", () => {
    const env = schedulerWith();
    env.scheduler.schedule({ id: "dup", pipelineId: "p" });
    assert.throws(
      () => env.scheduler.schedule({ id: "dup", pipelineId: "p" }),
      (error) => error instanceof DomainError && error.code === "DUPLICATE_ID"
    );
  });

  it("list returns independent snapshots", () => {
    const env = schedulerWith();
    const first = env.scheduler.list();
    env.scheduler.schedule({ id: "a", pipelineId: "p" });
    const second = env.scheduler.list();
    env.scheduler.schedule({ id: "b", pipelineId: "p" });
    assert.strictEqual(first.length, 0);
    assert.strictEqual(second.length, 1);
    assert.strictEqual(env.scheduler.list().length, 2);
  });

  it("get returns the registered schedule", () => {
    const env = schedulerWith();
    const schedule = env.scheduler.schedule({ id: "found", pipelineId: "p", version: 2 });
    assert.strictEqual(env.scheduler.get("found"), schedule);
    assert.strictEqual(env.scheduler.get("missing"), undefined);
  });

  it("unscheduling is idempotent and makes later triggers fail", () => {
    const env = schedulerWith();
    env.scheduler.schedule({ id: "a", pipelineId: "p" });
    assert.strictEqual(env.scheduler.unschedule("a"), true);
    assert.strictEqual(env.scheduler.unschedule("a"), false);
    assert.strictEqual(env.scheduler.list().length, 0);
    assert.throws(
      () => env.scheduler.trigger("a"),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("a manual schedule never runs on its own", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "manual", pipelineId: "p", trigger: { type: "manual" } });
    await delay(40);
    assert.strictEqual(env.dispatcher.list().length, 0);
    assert.strictEqual(env.runtime.runs().length, 0);
  });

  it("trigger dispatches the scheduled pipeline through the engine", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "daily", pipelineId: "p" });
    const dispatchId = env.scheduler.trigger("daily");

    await waitFor(env.dispatcher, dispatchId, "succeeded");
    const info = env.dispatcher.status(dispatchId);
    assert.strictEqual(info.pipelineId, "p");
    const runId = info.runId as string;
    const run = env.runtime.status(runId);
    assert.strictEqual(run.status, "succeeded");
    assert.strictEqual((run.execution?.run.result?.finalState as State).get("count"), 1);
  });

  it("each trigger starts an independent run", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "daily", pipelineId: "p" });

    const aId = env.scheduler.trigger("daily");
    const bId = env.scheduler.trigger("daily");

    await waitFor(env.dispatcher, aId, "succeeded");
    await waitFor(env.dispatcher, bId, "succeeded");

    const aRunId = env.dispatcher.status(aId).runId;
    const bRunId = env.dispatcher.status(bId).runId;
    assert.notStrictEqual(aRunId, bRunId);
    assert.strictEqual(env.runtime.runs().length, 2);
  });

  it("trigger passes run options through to the runtime", async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.onAny((event) => events.push(event.type));
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "daily", pipelineId: "p" });

    const dispatchId = env.scheduler.trigger("daily", { id: "custom-run", eventBus: bus });
    await waitFor(env.dispatcher, dispatchId, "succeeded");

    assert.strictEqual(env.dispatcher.status(dispatchId).runId, "custom-run");
    const run = env.runtime.status("custom-run");
    assert.strictEqual(run.status, "succeeded");
    assert.strictEqual((run.execution?.run.result?.finalState as State).get("count"), 1);
    assert.ok(events.includes("runtime.run.started"));
  });

  it("throws on trigger for an unknown schedule id", () => {
    const env = schedulerWith();
    assert.throws(
      () => env.scheduler.trigger("nope"),
      (error) => error instanceof DomainError && error.code === "INVALID_INPUT"
    );
  });

  it("requests runs only; the runtime records failures", async () => {
    const env = schedulerWith([boomAction()]);
    registerPipeline(env, "p", ["boom"]);
    env.scheduler.schedule({ id: "fragile", pipelineId: "p" });

    const dispatchId = env.scheduler.trigger("fragile");
    await waitFor(env.dispatcher, dispatchId, "failed");

    const info = env.dispatcher.status(dispatchId);
    assert.ok(info.error);
    const runId = info.runId as string;
    assert.ok(env.runtime.status(runId).error);
    assert.strictEqual(env.scheduler.list().length, 1);
  });

  it("keeps schedules isolated from each other", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    registerPipeline(env, "q", ["counter"]);
    env.scheduler.schedule({ id: "left", pipelineId: "p" });
    env.scheduler.schedule({ id: "right", pipelineId: "q" });

    const aId = env.scheduler.trigger("left");
    const bId = env.scheduler.trigger("right");
    await waitFor(env.dispatcher, aId, "succeeded");
    await waitFor(env.dispatcher, bId, "succeeded");

    assert.strictEqual(env.scheduler.list().length, 2);
    assert.strictEqual(env.runtime.runs().length, 2);
  });

  it("rescheduling the same id is rejected while registered", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "every", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });
    assert.throws(
      () => env.scheduler.schedule({ id: "every", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } }),
      (error) => error instanceof DomainError && error.code === "DUPLICATE_ID"
    );
    env.scheduler.stop();
  });

  it("unscheduling clears the repeated timer", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "every", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 1);
    assert.strictEqual(env.scheduler.unschedule("every"), true);
    assert.strictEqual(env.scheduler.get("every"), undefined);

    const after = env.dispatcher.list().length;
    await delay(40);
    assert.strictEqual(env.dispatcher.list().length, after);
  });
});

describe("Scheduler triggers (timer-based)", () => {
  it("an interval schedule triggers automatically", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "auto", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 2);
    assert.ok(env.dispatcher.list().length >= 2);
    env.scheduler.unschedule("auto");
  });

  it("each automatic trigger is an independent run", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "multi", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 3);
    const runIds = new Set<string>();
    for (const entry of env.dispatcher.list()) {
      runIds.add(await waitForRunId(env.dispatcher, entry.id));
    }
    assert.strictEqual(runIds.size, env.dispatcher.list().length);
    env.scheduler.stop();
  });

  it("a failing request does not kill the scheduler loop", async () => {
    const env = schedulerWith([boomAction()]);
    registerPipeline(env, "p", ["boom"]);
    env.scheduler.schedule({ id: "boom", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 2);
    await waitForAnyFailed(env.dispatcher);
    assert.ok(env.dispatcher.list().some((entry) => entry.status === "failed"));
    assert.strictEqual(env.scheduler.list().length, 1);
    env.scheduler.stop();
  });

  it("a disabled schedule never triggers automatically", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "off", pipelineId: "p", trigger: { type: "interval", everyMs: 20 }, enabled: false });

    await delay(40);
    assert.strictEqual(env.dispatcher.list().length, 0);
    assert.strictEqual(env.runtime.runs().length, 0);
  });

  it("multiple interval schedules run independently", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "one", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });
    env.scheduler.schedule({ id: "two", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 2);
    env.scheduler.stop();
    assert.strictEqual(env.dispatcher.list().length, 2);
  });

  it("rescheduling the same id after unschedule regenerates a single timer", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "once", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });
    await waitForDispatchCount(env.dispatcher, 1);
    env.scheduler.unschedule("once");
    const count = env.dispatcher.list().length;

    env.scheduler.schedule({ id: "once", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });
    await waitForDispatchCount(env.dispatcher, count + 1);
    await delay(10);
    assert.strictEqual(env.dispatcher.list().length, count + 1);
    env.scheduler.unschedule("once");
  });

  it("stop clears all pending timers; start re-arms them", async () => {
    const env = schedulerWith();
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "pause", pipelineId: "p", trigger: { type: "interval", everyMs: 20 } });

    await waitForDispatchCount(env.dispatcher, 1);
    env.scheduler.stop();
    const count = env.dispatcher.list().length;
    await delay(40);
    assert.strictEqual(env.dispatcher.list().length, count);

    env.scheduler.start();
    await waitForDispatchCount(env.dispatcher, count + 2);
    env.scheduler.stop();
  });
});

describe("Scheduler triggers (event-based)", () => {
  it("an event-triggered schedule dispatches the pipeline on a matching event", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "tick", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 1);
    const dispatchId = env.dispatcher.list()[0].id;
    await waitFor(env.dispatcher, dispatchId, "succeeded");
    assert.ok(env.dispatcher.status(dispatchId).runId);
    env.scheduler.stop();
  });

  it("an event schedule ignores non-matching events", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "tick", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.other");
    await delay(30);
    assert.strictEqual(env.dispatcher.list().length, 0);
  });

  it("an event schedule without an eventType reacts to any event", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "any", pipelineId: "p", trigger: { type: "event" } });

    bus.publish("dev.tick");
    bus.publish("dev.other");
    await waitForDispatchCount(env.dispatcher, 2);
    assert.strictEqual(env.dispatcher.list().length, 2);
    env.scheduler.stop();
  });

  it("multiple event schedules react independently to one publish", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "a", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });
    env.scheduler.schedule({ id: "b", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 2);
    assert.strictEqual(env.dispatcher.list().length, 2);
    env.scheduler.stop();
  });

  it("a disabled event schedule never reacts", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "off", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" }, enabled: false });

    bus.publish("dev.tick");
    await delay(30);
    assert.strictEqual(env.dispatcher.list().length, 0);
  });

  it("unschedule removes the event subscription", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "gone", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 1);
    assert.strictEqual(env.scheduler.unschedule("gone"), true);
    const count = env.dispatcher.list().length;
    bus.publish("dev.tick");
    await delay(30);
    assert.strictEqual(env.dispatcher.list().length, count);
  });

  it("stop unsubscribes all event listeners; start re-subscribes them", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "pause", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 1);
    env.scheduler.stop();
    const count = env.dispatcher.list().length;
    bus.publish("dev.tick");
    await delay(30);
    assert.strictEqual(env.dispatcher.list().length, count);

    env.scheduler.start();
    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, count + 1);
    env.scheduler.stop();
  });

  it("a failing request does not break the event loop or the schedule", async () => {
    const bus = new EventBus();
    const env = schedulerWith([boomAction()], bus);
    registerPipeline(env, "p", ["boom"]);
    env.scheduler.schedule({ id: "boom", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 2);
    await waitForAnyFailed(env.dispatcher);
    assert.ok(env.dispatcher.list().some((entry) => entry.status === "failed"));
    assert.strictEqual(env.scheduler.list().length, 1);
    env.scheduler.stop();
  });

  it("rescheduling the same id regenerates a single subscription", async () => {
    const bus = new EventBus();
    const env = schedulerWith([counterAction()], bus);
    registerPipeline(env, "p", ["counter"]);
    env.scheduler.schedule({ id: "once", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });
    env.scheduler.unschedule("once");
    env.scheduler.schedule({ id: "once", pipelineId: "p", trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForDispatchCount(env.dispatcher, 1);
    await delay(30);
    assert.strictEqual(env.dispatcher.list().length, 1);
    env.scheduler.stop();
  });
});