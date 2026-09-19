import {
  Edge,
  Graph,
  Node,
  PipelineVersion,
  StateSchema,
  type NodeOptions,
  type ResourceReference,
  type RetryPolicyOptions,
  type StateSchemaOptions,
} from "../../kernel/index.js";

export interface EditorNode {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly capabilityId?: string;
  readonly capabilityVersion?: number;
  readonly resourceReferences: readonly ResourceReference[];
  readonly retryPolicy?: RetryPolicyOptions;
}

export interface EditorEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly condition?: Readonly<Record<string, unknown>>;
}

export interface EditorSnapshot {
  readonly version: number;
  readonly nodes: readonly EditorNode[];
  readonly edges: readonly EditorEdge[];
  readonly stateSchema: StateSchemaOptions;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly dirty: boolean;
}

interface EditorDocument {
  readonly graph: Graph;
  readonly stateSchema: StateSchema;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class PipelineEditorState {
  private document: EditorDocument;
  private readonly past: EditorDocument[] = [];
  private readonly future: EditorDocument[] = [];
  private dirty = false;

  constructor(readonly version: number, source: PipelineVersion) {
    this.document = {
      graph: source.graph,
      stateSchema: source.stateSchema,
      metadata: source.metadata,
    };
    Object.freeze(this.document);
  }

  snapshot(): EditorSnapshot {
    return {
      version: this.version,
      nodes: [...this.document.graph.nodes.values()].map(toEditorNode),
      edges: this.document.graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edge.condition === undefined ? {} : { condition: edge.condition }),
      })),
      stateSchema: {
        name: this.document.stateSchema.name,
        version: this.document.stateSchema.version,
        fields: this.document.stateSchema.fields,
      },
      metadata: this.document.metadata,
      dirty: this.dirty,
    };
  }

  addNode(options: NodeOptions): void {
    this.update({ graph: this.document.graph.addNode(new Node(options)) });
  }

  updateNode(options: NodeOptions): void {
    if (!this.document.graph.hasNode(options.id)) {
      throw new Error(`Node "${options.id}" does not exist`);
    }
    const nodes = [...this.document.graph.nodes.values()].map((node) => node.id === options.id ? new Node(options) : node);
    this.update({ graph: new Graph({ nodes, edges: this.document.graph.edges }) });
  }

  removeNode(nodeId: string): void {
    if (!this.document.graph.hasNode(nodeId)) {
      throw new Error(`Node "${nodeId}" does not exist`);
    }
    const nodes = [...this.document.graph.nodes.values()].filter((node) => node.id !== nodeId);
    const edges = this.document.graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
    this.update({ graph: new Graph({ nodes, edges }) });
  }

  addEdge(from: string, to: string, label?: string): void {
    this.update({ graph: this.document.graph.addEdge(new Edge({ from, to, label })) });
  }

  removeEdge(from: string, to: string): void {
    const edges = this.document.graph.edges.filter((edge) => edge.from !== from || edge.to !== to);
    this.update({ graph: new Graph({ nodes: [...this.document.graph.nodes.values()], edges }) });
  }

  updateStateSchema(options: StateSchemaOptions): void {
    this.update({ stateSchema: new StateSchema(options) });
  }

  updateMetadata(metadata: Readonly<Record<string, unknown>>): void {
    this.update({ metadata: Object.freeze({ ...metadata }) });
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) {
      return false;
    }
    this.future.push(this.document);
    this.document = previous;
    this.dirty = true;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) {
      return false;
    }
    this.past.push(this.document);
    this.document = next;
    this.dirty = true;
    return true;
  }

  markSaved(): void {
    this.dirty = false;
    this.past.length = 0;
    this.future.length = 0;
  }

  toVersion(version = this.version): PipelineVersion {
    return new PipelineVersion({
      version,
      graph: this.document.graph,
      stateSchema: this.document.stateSchema,
      metadata: this.document.metadata,
    });
  }

  private update(change: Partial<EditorDocument>): void {
    this.past.push(this.document);
    this.future.length = 0;
    this.document = Object.freeze({ ...this.document, ...change });
    this.dirty = true;
  }
}

function toEditorNode(node: Node): EditorNode {
  return {
    id: node.id,
    type: node.type,
    version: node.version,
    metadata: node.metadata,
    ...(node.capabilityId === undefined ? {} : { capabilityId: node.capabilityId }),
    ...(node.capabilityVersion === undefined ? {} : { capabilityVersion: node.capabilityVersion }),
    resourceReferences: node.resourceReferences,
    ...(node.retryPolicy === undefined ? {} : {
      retryPolicy: {
        maxAttempts: node.retryPolicy.maxAttempts,
        ...(node.retryPolicy.delayMs === undefined ? {} : { delayMs: node.retryPolicy.delayMs }),
      },
    }),
  };
}