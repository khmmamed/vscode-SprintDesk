import * as assert from "assert";
import { State, StateSchema } from "../../src/kernel/index.js";

describe("kernel/state", () => {
  const schema = new StateSchema({
    name: "task",
    fields: {
      title: { type: "string" },
      priority: { type: "number" },
      approve: { type: "boolean", required: false },
      tags: { type: "array", items: "string", required: false },
    },
  });

  describe("StateSchema", () => {
    it("validates a conforming value", () => {
      const result = schema.validate({ title: "Ship", priority: 1 });
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it("reports missing required fields", () => {
      const result = schema.validate({ title: "Ship" });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some((e) => /priority/.test(e)));
    });

    it("reports type mismatches", () => {
      const result = schema.validate({ title: "Ship", priority: "high" });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some((e) => /priority/.test(e)));
    });
  });

  describe("State", () => {
    it("creates an immutable state validated against the schema", () => {
      const state = new State({ schema, value: { title: "Ship", priority: 1 } });
      assert.strictEqual(state.get("title"), "Ship");
      assert.strictEqual(state.version, 1);
      assert.ok(Object.isFrozen(state));
      assert.ok(Object.isFrozen(state.value));
    });

    it("rejects a value that violates the schema", () => {
      assert.throws(
        () => new State({ schema, value: { priority: 1 } }),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === "SCHEMA_VIOLATION"
      );
    });

    it("withValue returns a new higher-version state", () => {
      const state = new State({ schema, value: { title: "Ship", priority: 1 } });
      const next = state.withValue("priority", 2);
      assert.strictEqual(next.get("priority"), 2);
      assert.strictEqual(next.version, 2);
      assert.notStrictEqual(next, state);
      assert.strictEqual(state.get("priority"), 1);
    });
  });
});