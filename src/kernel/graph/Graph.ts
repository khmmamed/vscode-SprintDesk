import { DomainError } from "../DomainError.js";
import { Node } from "./Node.js";
import { Edge } from "./Edge.js";

export type GraphDagError =
  | { readonly reason: "DUPLICATE_ID"; readonly id: string }
  | { readonly reason: "UNRESOLVED_REFERENCE"; readonly ref: string; readonly endpoint: "from" | "to" }
  | { readonly reason: "SELF_LOOP"; readonly nodeId: string }
  | { readonly reason: "CYCLE"; readonly cycle: readonly string[] };

export interface GraphOptions {
  readonly nodes?: readonly Node[];
  readonly edges?: readonly Edge[];
}

export class Graph {
  readonly nodes: ReadonlyMap<string, Node>;
  readonly edges: readonly Edge[];

  constructor(options: GraphOptions = {}) {
    const nodeList = options.nodes ?? [];
    const edgeList = options.edges ?? [];

    const nodes = new Map<string, Node>();
    for (const node of nodeList) {
      if (nodes.has(node.id)) {
        throw this.error({ reason: "DUPLICATE_ID", id: node.id });
      }
      nodes.set(node.id, node);
    }

    for (const edge of edgeList) {
      if (!nodes.has(edge.from)) {
        throw this.error({ reason: "UNRESOLVED_REFERENCE", ref: edge.from, endpoint: "from" });
      }
      if (!nodes.has(edge.to)) {
        throw this.error({ reason: "UNRESOLVED_REFERENCE", ref: edge.to, endpoint: "to" });
      }
      if (edge.from === edge.to) {
        throw this.error({ reason: "SELF_LOOP", nodeId: edge.from });
      }
    }

    const adjacency = new Map<string, string[]>();
    for (const id of nodes.keys()) {
      adjacency.set(id, []);
    }
    for (const edge of edgeList) {
      adjacency.get(edge.from)!.push(edge.to);
    }
    const cycle = findCycle(adjacency);
    if (cycle.length > 0) {
      throw this.error({ reason: "CYCLE", cycle });
    }

    this.nodes = nodes;
    this.edges = Object.freeze([...edgeList]);
    Object.freeze(this);
  }

  private error(details: GraphDagError): DomainError {
    return graphError(details);
  }
    get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.length;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  addNode(node: Node): Graph {
    return new Graph({ nodes: [...this.nodes.values(), node], edges: this.edges });
  }

  addEdge(edge: Edge): Graph {
    return new Graph({ nodes: [...this.nodes.values()], edges: [...this.edges, edge] });
  }

  validate(): void {
    assertDag(this);
  }

  createCycleError(): DomainError {
    const cycle = findCycle(buildAdjacency(this));
    return this.error({ reason: "CYCLE", cycle });
  }

  topologicalOrder(): readonly Node[] {
    const order = topologicalSort(this);
    if (order.length !== this.nodeCount) {
      throw this.error({ reason: "CYCLE", cycle: [] });
    }
    return order;
  }

  upstreamOf(nodeId: string): readonly Node[] {
    return ancestors(this, nodeId);
  }

  downstreamOf(nodeId: string): readonly Node[] {
    return descendants(this, nodeId);
  }
}

function graphError(details: GraphDagError): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Invalid graph: ${JSON.stringify(details)}`,
    details,
  });
}

function buildAdjacency(graph: Graph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) {
    adjacency.set(id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)!.push(edge.to);
  }
  return adjacency;
}

function buildReverseAdjacency(graph: Graph): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) {
    reverse.set(id, []);
  }
  for (const edge of graph.edges) {
    reverse.get(edge.to)!.push(edge.from);
  }
  return reverse;
}

function findCycle(adjacency: Map<string, string[]>): string[] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  for (const root of adjacency.keys()) {
    if (state.has(root)) {
      continue;
    }
    const result = dfsDetect(root, adjacency, state, stack);
    if (result) {
      return result;
    }
  }
  return [];
}

function dfsDetect(
  node: string,
  adjacency: Map<string, string[]>,
  state: Map<string, "visiting" | "visited">,
  stack: string[]
): string[] | undefined {
  state.set(node, "visiting");
  stack.push(node);
  for (const next of adjacency.get(node) ?? []) {
    if (state.get(next) === "visiting") {
      const start = stack.indexOf(next);
      return [...stack.slice(start), next];
    }
    if (state.get(next) === undefined) {
      const result = dfsDetect(next, adjacency, state, stack);
      if (result) {
        return result;
      }
    }
  }
  stack.pop();
  state.set(node, "visited");
  return undefined;
}

function assertDag(graph: Graph): void {
  const cycle = findCycle(buildAdjacency(graph));
  if (cycle.length > 0) {
    throw graphError({ reason: "CYCLE", cycle });
  }
}

function topologicalSort(graph: Graph): Node[] {
  const inDegree = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    inDegree.set(id, 0);
  }
  const adjacency = buildAdjacency(graph);
  for (const nodeId of graph.nodes.keys()) {
    for (const next of adjacency.get(nodeId) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }
  const ready = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order: Node[] = [];
  const queue = [...ready];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(graph.nodes.get(id)!);
    for (const next of adjacency.get(id) ?? []) {
      const degree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
      }
    }
  }
  return order;
}

function ancestors(graph: Graph, nodeId: string): Node[] {
  if (!graph.nodes.has(nodeId)) {
    return [];
  }
  const reverse = buildReverseAdjacency(graph);
  const result: Node[] = [];
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const parent of reverse.get(current) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        result.push(graph.nodes.get(parent)!);
        stack.push(parent);
      }
    }
  }
  return result;
}

function descendants(graph: Graph, nodeId: string): Node[] {
  if (!graph.nodes.has(nodeId)) {
    return [];
  }
  const adjacency = buildAdjacency(graph);
  const result: Node[] = [];
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of adjacency.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        result.push(graph.nodes.get(child)!);
        stack.push(child);
      }
    }
  }
  return result;
}