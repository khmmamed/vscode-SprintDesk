import * as assert from "assert";
import { Graph, Node, Edge } from "../../src/kernel/index.js";

describe("kernel/graph", () => {
  describe("Node", () => {
    it("creates a frozen node with normalized id/type", () => {
      const node = new Node({ id: "  a  ", type: "task" });
      assert.strictEqual(node.id, "a");
      assert.strictEqual(node.type, "task");
      assert.strictEqual(node.version, 1);
      assert.ok(Object.isFrozen(node));
    });

    it("rejects empty id", () => {
      assert.throws(() => new Node({ id: "  ", type: "task" }));
    });

    it("rejects empty type", () => {
      assert.throws(() => new Node({ id: "a", type: " " }));
    });
  });

  describe("Edge", () => {
    it("creates a frozen edge", () => {
      const edge = new Edge({ from: "a", to: "b", label: "then" });
      assert.strictEqual(edge.from, "a");
      assert.strictEqual(edge.to, "b");
      assert.strictEqual(edge.label, "then");
      assert.ok(Object.isFrozen(edge));
    });

    it("rejects empty endpoints", () => {
      assert.throws(() => new Edge({ from: "", to: "b" }));
    });
  });

  describe("Graph DAG invariant", () => {
    it("builds a valid linear graph", () => {
      const graph = new Graph({
        nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" }), new Node({ id: "c", type: "t" })],
        edges: [new Edge({ from: "a", to: "b" }), new Edge({ from: "b", to: "c" })],
      });
      assert.strictEqual(graph.nodeCount, 3);
      assert.strictEqual(graph.edgeCount, 2);
      assert.deepStrictEqual(graph.topologicalOrder().map((n) => n.id), ["a", "b", "c"]);
    });

    it("rejects duplicate node ids", () => {
      assert.throws(
        () =>
          new Graph({
            nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "a", type: "t" })],
          }),
        /DUPLICATE_ID/
      );
    });

    it("rejects a dangling edge reference", () => {
      assert.throws(
        () =>
          new Graph({
            nodes: [new Node({ id: "a", type: "t" })],
            edges: [new Edge({ from: "a", to: "missing" })],
          }),
        /UNRESOLVED_REFERENCE/
      );
    });

    it("rejects a self loop", () => {
      assert.throws(
        () =>
          new Graph({
            nodes: [new Node({ id: "a", type: "t" })],
            edges: [new Edge({ from: "a", to: "a" })],
          }),
        /SELF_LOOP/
      );
    });

    it("rejects a cyclic graph at construction", () => {
      assert.throws(
        () =>
          new Graph({
            nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" })],
            edges: [new Edge({ from: "a", to: "b" }), new Edge({ from: "b", to: "a" })],
          }),
        /CYCLE/
      );
    });

    it("rejects a cycle introduced via addEdge", () => {
      const graph = new Graph({
        nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" })],
        edges: [new Edge({ from: "a", to: "b" })],
      });
      assert.throws(() => graph.addEdge(new Edge({ from: "b", to: "a" })), /CYCLE/);
    });

    it("rejects an indirect cycle introduced via addEdge", () => {
      const graph = new Graph({
        nodes: [
          new Node({ id: "a", type: "t" }),
          new Node({ id: "b", type: "t" }),
          new Node({ id: "c", type: "t" }),
        ],
        edges: [new Edge({ from: "a", to: "b" }), new Edge({ from: "b", to: "c" })],
      });
      assert.throws(() => graph.addEdge(new Edge({ from: "c", to: "a" })), /CYCLE/);
    });

    it("is immutable: addEdge returns a new graph", () => {
      const graph = new Graph({
        nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" })],
      });
      const extended = graph.addEdge(new Edge({ from: "a", to: "b" }));
      assert.strictEqual(graph.edgeCount, 0);
      assert.strictEqual(extended.edgeCount, 1);
      assert.ok(Object.isFrozen(graph));
      assert.ok(Object.isFrozen(extended));
    });

    it("validate() passes on a dag and throws on a cycle", () => {
      const good = new Graph({
        nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" })],
        edges: [new Edge({ from: "a", to: "b" })],
      });
      assert.doesNotThrow(() => good.validate());
      assert.throws(
        () =>
          new Graph({
            nodes: [new Node({ id: "a", type: "t" }), new Node({ id: "b", type: "t" })],
            edges: [new Edge({ from: "a", to: "b" }), new Edge({ from: "b", to: "a" })],
          }).validate(),
        /CYCLE/
      );
    });
  });

  describe("Graph traversal", () => {
    const graph = new Graph({
      nodes: [
        new Node({ id: "a", type: "t" }),
        new Node({ id: "b", type: "t" }),
        new Node({ id: "c", type: "t" }),
        new Node({ id: "d", type: "t" }),
      ],
      edges: [
        new Edge({ from: "a", to: "b" }),
        new Edge({ from: "a", to: "c" }),
        new Edge({ from: "b", to: "d" }),
        new Edge({ from: "c", to: "d" }),
      ],
    });

    it("returns a valid topological order covering all nodes", () => {
      const ids = graph.topologicalOrder().map((n) => n.id);
      assert.strictEqual(ids.length, 4);
      assert.ok(ids.indexOf("a") < ids.indexOf("b"));
      assert.ok(ids.indexOf("a") < ids.indexOf("c"));
      assert.ok(ids.indexOf("b") < ids.indexOf("d"));
      assert.ok(ids.indexOf("c") < ids.indexOf("d"));
    });

    it("returns upstream (transitive) ancestors", () => {
      assert.deepStrictEqual(graph.upstreamOf("d").map((n) => n.id).sort(), ["a", "b", "c"]);
    });

    it("returns downstream (transitive) descendants", () => {
      assert.deepStrictEqual(graph.downstreamOf("a").map((n) => n.id).sort(), ["b", "c", "d"]);
    });
  });
});