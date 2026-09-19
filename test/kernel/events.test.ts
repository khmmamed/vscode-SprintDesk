import * as assert from "assert";
import { Event, EventBus } from "../../src/kernel/index.js";

describe("kernel/events", () => {
  describe("Event", () => {
    it("creates a frozen event with normalized type and frozen payload", () => {
      const event = new Event({ type: " run.started ", payload: { runId: "r1" } });
      assert.strictEqual(event.type, "run.started");
      assert.deepStrictEqual(event.payload, { runId: "r1" });
      assert.ok(Object.isFrozen(event));
      assert.ok(Object.isFrozen(event.payload));
    });

    it("rejects an empty type", () => {
      assert.throws(() => new Event({ type: "  " }));
    });
  });

  describe("EventBus", () => {
    it("delivers typed events to subscribers", () => {
      const bus = new EventBus();
      const seen: Event[] = [];
      bus.subscribe("run.started", (event) => seen.push(event));
      const published = bus.publish("run.started", { runId: "r1" });
      assert.strictEqual(published.type, "run.started");
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].payload.runId, "r1");
    });

    it("does not deliver to subscribers of other types", () => {
      const bus = new EventBus();
      const seen: Event[] = [];
      bus.subscribe("run.finished", (event) => seen.push(event));
      bus.publish("run.started", {});
      assert.strictEqual(seen.length, 0);
    });

    it("unsubscribes a listener", () => {
      const bus = new EventBus();
      const seen: Event[] = [];
      const unsubscribe = bus.subscribe("run.started", (event) => seen.push(event));
      unsubscribe();
      bus.publish("run.started", {});
      assert.strictEqual(seen.length, 0);
    });

    it("once fires a single time", () => {
      const bus = new EventBus();
      const seen: Event[] = [];
      bus.once("run.started", (event) => seen.push(event));
      bus.publish("run.started", {});
      bus.publish("run.started", {});
      assert.strictEqual(seen.length, 1);
    });

    it("assigns monotonically increasing sequence numbers", () => {
      const bus = new EventBus();
      const first = bus.publish("a", {});
      const second = bus.publish("b", {});
      assert.ok(second.sequence > first.sequence);
    });

    it("retains history for late joiners", () => {
      const bus = new EventBus();
      bus.publish("run.started", { runId: "r1" });
      bus.publish("run.finished", { runId: "r1" });
      assert.strictEqual(bus.history().length, 2);
      assert.deepStrictEqual(bus.historyOf("run.started").map((e) => e.type), ["run.started"]);
    });

    it("delivers wildcard events via onAny", () => {
      const bus = new EventBus();
      const seen: Event[] = [];
      bus.onAny((event) => seen.push(event));
      bus.publish("anything", {});
      assert.strictEqual(seen.length, 1);
    });
  });
});