import * as assert from "assert";
import { DomainError, Graph, Node, type NodeOptions } from "../../src/kernel/index.js";

describe("kernel/graph/Node capability reference", () => {
  it("keeps a Node without a capability valid and backward compatible", () => {
    const node = new Node({ id: "a", type: "task", version: 2, metadata: { x: 1 } });
    assert.strictEqual(node.id, "a");
    assert.strictEqual(node.type, "task");
    assert.strictEqual(node.version, 2);
    assert.deepStrictEqual(node.metadata, { x: 1 });
    assert.strictEqual(node.capabilityId, undefined);
    assert.strictEqual("capabilityId" in node, false);
    assert.ok(Object.isFrozen(node));
  });

  it("accepts a Node with a capabilityId, trimmed like other fields", () => {
    const node = new Node({ id: "a", type: "task", capabilityId: "  capability.report  " });
    assert.strictEqual(node.capabilityId, "capability.report");
  });

  it("accepts Nodes with a capabilityId inside a Graph", () => {
    const graph = new Graph({
      nodes: [
        new Node({ id: "a", type: "t", capabilityId: "cap.list" }),
        new Node({ id: "b", type: "t" }),
      ],
      edges: [{ from: "a", to: "b" }],
    });
    assert.strictEqual(graph.getNode("a")?.capabilityId, "cap.list");
    assert.strictEqual(graph.getNode("b")?.capabilityId, undefined);
    assert.strictEqual(graph.topologicalOrder().length, 2);
  });

  it("rejects an invalid capabilityId", () => {
    const cases: Array<[NodeOptions, string]> = [
      [{ id: "a", type: "t", capabilityId: "   " }, "must be a non-empty string"],
      [{ id: "a", type: "t", capabilityId: "" }, "must be a non-empty string"],
      [{ id: "a", type: "t", capabilityId: 42 as unknown as string }, "must be a string"],
    ];
    for (const [options, messageSnippet] of cases) {
      let thrown: DomainError | undefined;
      try {
        new Node(options);
      } catch (error) {
        thrown = error as DomainError;
      }
      assert.ok(thrown instanceof DomainError, `expected DomainError for ${JSON.stringify(options)}`);
      assert.strictEqual(thrown.code, "INVALID_INPUT");
      assert.ok(thrown.message.includes(messageSnippet));
    }
  });

  it("keeps the capabilityId immutable", () => {
    const node = new Node({ id: "a", type: "t", capabilityId: "cap.one" });
    assert.ok(Object.isFrozen(node));
    assert.strictEqual(Reflect.set(node, "capabilityId", "cap.two"), false);
    assert.strictEqual(node.capabilityId, "cap.one");
    assert.strictEqual(Reflect.set(node, "id", "other"), false);
    assert.strictEqual(node.id, "a");
  });

  it("round-trips the capabilityId as plain immutable data", () => {
    const node = new Node({ id: "a", type: "t", capabilityId: "cap.three", metadata: { m: 1 } });
    const plain = { ...node };
    const jsonRoundTripped = JSON.parse(JSON.stringify(node));
    assert.strictEqual(plain.capabilityId, "cap.three");
    assert.strictEqual(jsonRoundTripped.capabilityId, "cap.three");
    const rebuilt = new Node(jsonRoundTripped as NodeOptions);
    assert.strictEqual(rebuilt.capabilityId, "cap.three");
    assert.strictEqual(rebuilt.type, "t");
  });

  it("has no structural equals; instances compare by identity like before", () => {
    const opts: NodeOptions = { id: "a", type: "t", capabilityId: "cap.x" };
    const one = new Node(opts);
    const two = new Node(opts);
    assert.notStrictEqual(one, two);
    assert.strictEqual("equals" in one, false);
  });
});