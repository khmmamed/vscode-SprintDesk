import * as assert from "assert";
import {
  DomainError,
  EventBus,
  Graph,
  Node,
  PipelineVersion,
  State,
  StateSchema,
  type Event,
  type SchemaField,
} from "../../src/kernel/index.js";
import { Executor, Runtime, Schedule, Scheduler, type NodeAction } from "../../src/runtime/index.js";

function schema(fields: Readonly<Record<string, SchemaField>> = {}): StateSchema {
  return new StateSchema({ name: "scheduler", fields });
}

function graphOf(nodes: Array<{ id: string; type: string }>, edges: string[][] = []): Graph {
  return new Graph({
    nodes: nodes.map(({ id, type }) => new Node({ id, type })),
    edges: edges.map(([from, to]) => ({ from, to }) as { from: string; to: string }),
  });
}

function counterVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([{ id: "counter", type: "counter" }]),
    stateSchema: schema({ count: { type: "number", required: false } }),
  });
}

function failingVersion(): PipelineVersion {
  return new PipelineVersion({
    version: 1,
    graph: graphOf([{ id: "boom", type: "boom" }]),
    stateSchema: schema({ count: { type: "number", required: false } }),
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

function schedulerWith(
  actions: readonly NodeAction[] = [counterAction()],
  eventBus?: EventBus
): { scheduler: Scheduler; runtime: Runtime; bus?: EventBus } {
  const runtime = new Runtime({ executor: new Executor({ actions }) });
  return { scheduler: new Scheduler({ runtime, eventBus }), runtime, bus: eventBus };
}

async function waitForStatus(runtime: Runtime, id: string, status: string, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.status(id).status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`run "${id}" did not reach status "${status}" in time`);
}

describe("runtime/Schedule", () => {
  it("creates an immutable schedule bound to a pipeline version", () => {
    const version = counterVersion();
    const schedule = new Schedule({ id: "daily", version, createdAt: 12345 });

    assert.strictEqual(schedule.id, "daily");
    assert.strictEqual(schedule.version, version);
    assert.strictEqual(schedule.createdAt, 12345);
    assert.ok(Object.isFrozen(schedule));
  });

  it("defaults createdAt to the current time", () => {
    const before = Date.now();
    const schedule = new Schedule({ id: "now", version: counterVersion() });
    assert.ok(schedule.createdAt >= before && schedule.createdAt <= Date.now());
  });

  it("rejects a blank schedule id", () => {
    assert.throws(() => new Schedule({ id: "   ", version: counterVersion() }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
      return true;
    });
  });

  it("defaults the trigger to manual and enabled to true", () => {
    const schedule = new Schedule({ id: "plain", version: counterVersion() });
    assert.deepStrictEqual(schedule.trigger, { type: "manual" });
    assert.strictEqual(schedule.enabled, true);
  });

  it("holds an interval trigger", () => {
    const schedule = new Schedule({ id: "every", version: counterVersion(), trigger: { type: "interval", everyMs: 500 } });
    assert.deepStrictEqual(schedule.trigger, { type: "interval", everyMs: 500 });
  });

  it("rejects a non-positive or non-finite interval", () => {
    for (const everyMs of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new Schedule({ id: "bad", version: counterVersion(), trigger: { type: "interval", everyMs } }),
        (error: unknown) => {
          assert.ok(error instanceof DomainError);
          assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
          return true;
        }
      );
    }
  });

  it("honors an explicit enabled flag", () => {
    const off = new Schedule({ id: "off", version: counterVersion(), enabled: false });
    assert.strictEqual(off.enabled, false);
  });

  it("holds an event trigger and preserves its eventType", () => {
    const schedule = new Schedule({ id: "evt", version: counterVersion(), trigger: { type: "event", eventType: "pipeline.tick" } });
    assert.deepStrictEqual(schedule.trigger, { type: "event", eventType: "pipeline.tick" });
  });

  it("holds an event trigger without an eventType", () => {
    const schedule = new Schedule({ id: "all", version: counterVersion(), trigger: { type: "event" } });
    assert.deepStrictEqual(schedule.trigger, { type: "event" });
  });

  it("rejects a blank eventType", () => {
    assert.throws(
      () => new Schedule({ id: "bad", version: counterVersion(), trigger: { type: "event", eventType: "   " } }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
        return true;
      }
    );
  });
});

describe("runtime/Scheduler", () => {
  it("registers a schedule and lists it", () => {
    const { scheduler } = schedulerWith();
    const version = counterVersion();
    const schedule = scheduler.schedule({ id: "daily", version });

    assert.strictEqual(scheduler.list().length, 1);
    assert.strictEqual(scheduler.list()[0], schedule);
    assert.strictEqual(scheduler.list()[0].id, "daily");
    assert.strictEqual(scheduler.list()[0].version, version);
  });

  it("generates an id when none is provided", () => {
    const { scheduler } = schedulerWith();
    const schedule = scheduler.schedule({ version: counterVersion() });
    assert.match(schedule.id, /^schedule-\d+$/);
  });

  it("rejects duplicate schedule ids", () => {
    const { scheduler } = schedulerWith();
    scheduler.schedule({ id: "dup", version: counterVersion() });
    assert.throws(() => scheduler.schedule({ id: "dup", version: counterVersion() }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "DUPLICATE_ID");
      return true;
    });
  });

  it("unschedules a schedule and is idempotent", () => {
    const { scheduler } = schedulerWith();
    scheduler.schedule({ id: "a", version: counterVersion() });

    assert.strictEqual(scheduler.unschedule("a"), true);
    assert.strictEqual(scheduler.unschedule("a"), false);
    assert.strictEqual(scheduler.list().length, 0);
    assert.throws(() => scheduler.trigger("a"), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
      return true;
    });
  });

  it("list returns independent snapshots", () => {
    const { scheduler } = schedulerWith();
    const first = scheduler.list();
    scheduler.schedule({ id: "a", version: counterVersion() });
    const second = scheduler.list();
    scheduler.schedule({ id: "b", version: counterVersion() });

    assert.strictEqual(first.length, 0);
    assert.strictEqual(second.length, 1);
    assert.strictEqual(scheduler.list().length, 2);
  });

  it("scheduling alone never starts a run", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "idle", version: counterVersion() });

    assert.strictEqual(runtime.runs().length, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(runtime.runs().length, 0);
  });

  it("trigger runs the scheduled pipeline through the runtime", async () => {
    const { scheduler, runtime } = schedulerWith();
    const schedule = scheduler.schedule({ id: "run", version: counterVersion() });

    const runId = scheduler.trigger(schedule.id);
    assert.ok(runId.length > 0);
    await waitForStatus(runtime, runId, "succeeded");

    const info = runtime.status(runId);
    assert.strictEqual(info.status, "succeeded");
    assert.strictEqual((info.execution?.run.result?.finalState as State).get("count"), 1);
  });

  it("trigger passes run options through to the runtime", async () => {
    const { scheduler, runtime } = schedulerWith();
    const bus = new EventBus();
    const events: string[] = [];
    bus.onAny((event: Event) => events.push(event.type));
    const schedule = scheduler.schedule({ id: "opts", version: counterVersion() });

    const runId = scheduler.trigger(schedule.id, { id: "custom-run", eventBus: bus });
    assert.strictEqual(runId, "custom-run");
    await waitForStatus(runtime, "custom-run", "succeeded");
    assert.ok(events.includes("runtime.run.started"));
  });

  it("each trigger starts an independent run", async () => {
    const { scheduler, runtime } = schedulerWith();
    const schedule = scheduler.schedule({ id: "multi", version: counterVersion() });

    const a = scheduler.trigger(schedule.id);
    const b = scheduler.trigger(schedule.id);
    assert.notStrictEqual(a, b);
    await waitForStatus(runtime, a, "succeeded");
    await waitForStatus(runtime, b, "succeeded");
    assert.strictEqual(runtime.runs().length, 2);
  });

  it("throws on trigger for an unknown schedule id", () => {
    const { scheduler } = schedulerWith();
    assert.throws(() => scheduler.trigger("nope"), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
      return true;
    });
  });

  it("requests runs only; the runtime records failures", async () => {
    const { scheduler, runtime } = schedulerWith([boomAction()]);
    scheduler.schedule({ id: "failing", version: failingVersion() });

    const runId = scheduler.trigger("failing");
    assert.ok(runId.length > 0);
    await waitForStatus(runtime, runId, "failed");
    assert.ok(runtime.status(runId).error);
    assert.strictEqual(scheduler.list().length, 1);
  });

  it("keeps schedules isolated from each other", async () => {
    const { scheduler, runtime } = schedulerWith();
    const a = scheduler.schedule({ id: "left", version: counterVersion() });
    const b = scheduler.schedule({ id: "right", version: counterVersion() });

    const ra = scheduler.trigger(a.id);
    const rb = scheduler.trigger(b.id);
    await waitForStatus(runtime, ra, "succeeded");
    await waitForStatus(runtime, rb, "succeeded");

    assert.strictEqual(scheduler.list().length, 2);
    assert.strictEqual(runtime.runs().length, 2);
  });

  it("get returns the registered schedule", () => {
    const { scheduler } = schedulerWith();
    const schedule = scheduler.schedule({ id: "found", version: counterVersion() });
    assert.strictEqual(scheduler.get("found"), schedule);
    assert.strictEqual(scheduler.get("missing"), undefined);
  });
});

async function waitForCount(runtime: Runtime, expected: number, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.runs().length >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`expected at least ${expected} runs; got ${runtime.runs().length}`);
}

async function waitForAnyFailed(runtime: Runtime, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime.runs().some((run) => runtime.status(run.id).status === "failed")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("expected at least one failed run");
}

describe("runtime/Scheduler triggers (timer-based)", () => {
  it("a manual schedule never runs on its own", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "manual", version: counterVersion(), trigger: { type: "manual" } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.strictEqual(runtime.runs().length, 0);
  });

  it("an interval schedule triggers automatically", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "auto", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 2);
    scheduler.unschedule("auto");
    assert.ok(runtime.runs().length >= 2);
  });

  it("each automatic trigger is an independent run", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "multi", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 3);
    scheduler.unschedule("multi");
    const ids = new Set(runtime.runs().map((run) => run.id));
    assert.strictEqual(ids.size, runtime.runs().length);
    assert.ok(runtime.runs().length >= 3);
  });

  it("unscheduling stops future automatic triggers", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "stop", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 2);
    scheduler.unschedule("stop");
    const count = runtime.runs().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(runtime.runs().length, count);
  });

  it("a disabled schedule never triggers automatically", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "off", version: counterVersion(), trigger: { type: "interval", everyMs: 20 }, enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(runtime.runs().length, 0);
  });

  it("rejects an invalid interval on schedule registration", () => {
    const { scheduler } = schedulerWith();
    assert.throws(
      () => scheduler.schedule({ id: "bad", version: counterVersion(), trigger: { type: "interval", everyMs: 0 } }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
        return true;
      }
    );
  });

  it("multiple interval schedules run independently", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "one", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    scheduler.schedule({ id: "two", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 2);
    scheduler.stop();
    assert.strictEqual(runtime.runs().length, 2);
  });

  it("stop clears all pending timers; start re-arms them", async () => {
    const { scheduler, runtime } = schedulerWith();
    scheduler.schedule({ id: "pause", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 1);
    scheduler.stop();
    const count = runtime.runs().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(runtime.runs().length, count);
    scheduler.start();
    await waitForCount(runtime, count + 2);
    scheduler.stop();
  });

  it("a failing runtime does not kill the scheduler loop", async () => {
    const { scheduler, runtime } = schedulerWith([boomAction()]);
    scheduler.schedule({ id: "fails", version: failingVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 2);
    assert.ok(runtime.runs().some((run) => runtime.status(run.id).status === "failed"));
    assert.strictEqual(scheduler.list().length, 1);
    scheduler.unschedule("fails");
  });

  it("rescheduling the same id creates one timer", async () => {
    const { scheduler, runtime } = schedulerWith();
    const first = scheduler.schedule({ id: "one-timer", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, 1);
    scheduler.unschedule("one-timer");
    assert.ok(runtime.runs().length >= 1);
    const count = runtime.runs().length;
    scheduler.schedule({ id: "one-timer", version: counterVersion(), trigger: { type: "interval", everyMs: 20 } });
    await waitForCount(runtime, count + 1);
    scheduler.unschedule("one-timer");
    void first;
  });
});

describe("runtime/Scheduler triggers (event-based)", () => {
  it("an event trigger fires a run when a matching event is published", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "evt", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForCount(runtime, 1);
    assert.strictEqual(runtime.runs().length, 1);
  });

  it("an event trigger ignores other event types", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "tick", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.other");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(runtime.runs().length, 0);
  });

  it("an event trigger without eventType reacts to every event", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "all", version: counterVersion(), trigger: { type: "event" } });

    bus.publish("dev.tick");
    bus.publish("dev.other");
    await waitForCount(runtime, 2);
    assert.strictEqual(runtime.runs().length, 2);
  });

  it("multiple event schedules react independently to one publish", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "a", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });
    scheduler.schedule({ id: "b", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForCount(runtime, 2);
    assert.strictEqual(runtime.runs().length, 2);
  });

  it("unschedule removes the event subscription", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "gone", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForCount(runtime, 1);
    assert.strictEqual(scheduler.unschedule("gone"), true);
    const count = runtime.runs().length;
    bus.publish("dev.tick");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(runtime.runs().length, count);
  });

  it("a disabled event schedule never reacts", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "off", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" }, enabled: false });

    bus.publish("dev.tick");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(runtime.runs().length, 0);
  });

  it("stop unsubscribes all event listeners; start re-subscribes them", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "pause", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForCount(runtime, 1);
    scheduler.stop();
    const count = runtime.runs().length;
    bus.publish("dev.tick");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(runtime.runs().length, count);
    scheduler.start();
    bus.publish("dev.tick");
    await waitForCount(runtime, count + 1);
  });

  it("a failing runtime does not break the event loop or the schedule", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([boomAction()], bus);
    scheduler.schedule({ id: "boom", version: failingVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    bus.publish("dev.tick");
    await waitForCount(runtime, 2);
    await waitForAnyFailed(runtime);
    assert.ok(runtime.runs().some((run) => runtime.status(run.id).status === "failed"));
    assert.strictEqual(scheduler.list().length, 1);
  });

  it("rescheduling the same id regenerates a single subscription", async () => {
    const bus = new EventBus();
    const { scheduler, runtime } = schedulerWith([counterAction()], bus);
    scheduler.schedule({ id: "once", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });
    scheduler.unschedule("once");
    scheduler.schedule({ id: "once", version: counterVersion(), trigger: { type: "event", eventType: "dev.tick" } });

    bus.publish("dev.tick");
    await waitForCount(runtime, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(runtime.runs().length, 1);
  });
});