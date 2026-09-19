import {
  Edge,
  Graph,
  Node,
  Pipeline,
  PipelineVersion,
  StateSchema,
  type EdgeOptions,
  type NodeOptions,
  type PipelineOptions,
  type StateSchemaOptions,
} from "../../kernel/index.js";
import { PlatformError } from "../PlatformError.js";
import type { PipelineDefinition } from "../ir/PipelineIr.js";
import { pipelineFromDefinition } from "../ir/PipelineIr.js";
import { PipelineService } from "./PipelineService.js";

export interface PipelineVersionEdit {
  readonly graph?: Graph;
  readonly stateSchema?: StateSchema;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PipelineAuthoringOptions {
  readonly pipelineService: PipelineService;
}

export class PipelineAuthoringService {
  readonly pipelineService: PipelineService;

  constructor(options: PipelineAuthoringOptions) {
    this.pipelineService = options.pipelineService;
  }

  createPipeline(options: Pipeline | PipelineOptions): Pipeline {
    return this.pipelineService.create(options);
  }

  updatePipelineMetadata(
    pipelineId: string,
    changes: { readonly name?: string; readonly metadata?: Readonly<Record<string, unknown>> }
  ): Pipeline {
    const current = this.pipelineService.get(pipelineId);
    const replacement = new Pipeline({
      id: current.id,
      name: changes.name ?? current.name,
      versions: current.versions,
      metadata: changes.metadata ?? current.metadata,
    });
    this.pipelineService.replace(pipelineId, replacement);
    return replacement;
  }

  createVersion(pipelineId: string, definition: PipelineVersion | PipelineDefinition): PipelineVersion {
    if (definition instanceof PipelineVersion) {
      return this.pipelineService.createVersion(pipelineId, definition);
    }
    const pipeline = pipelineFromDefinition({
      id: pipelineId,
      name: this.pipelineService.get(pipelineId).name,
      versions: [definition.versions[0]],
      metadata: this.pipelineService.get(pipelineId).metadata,
    });
    const version = pipeline.latestVersion();
    if (!version) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", "Pipeline definition must contain a version", { pipelineId });
    }
    return this.pipelineService.createVersion(pipelineId, version);
  }

  cloneVersion(pipelineId: string, sourceVersion: number, targetVersion: number): PipelineVersion {
    const source = this.pipelineService.getVersion(pipelineId, sourceVersion);
    return this.pipelineService.createVersion(pipelineId, new PipelineVersion({
      version: targetVersion,
      graph: source.graph,
      stateSchema: source.stateSchema,
      metadata: source.metadata,
    }));
  }

  editVersion(pipelineId: string, version: number, edit: PipelineVersionEdit): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    return this.pipelineService.createVersion(pipelineId, new PipelineVersion({
      version,
      graph: edit.graph ?? current.graph,
      stateSchema: edit.stateSchema ?? current.stateSchema,
      metadata: edit.metadata ?? current.metadata,
    }));
  }

  addNode(pipelineId: string, version: number, options: NodeOptions): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    return this.editVersion(pipelineId, version, { graph: current.graph.addNode(new Node(options)) });
  }

  replaceNode(pipelineId: string, version: number, options: NodeOptions): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    if (!current.graph.hasNode(options.id)) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", `Node "${options.id}" does not exist`, { pipelineId, version });
    }
    const nodes = [...current.graph.nodes.values()].map((node) => node.id === options.id ? new Node(options) : node);
    return this.editVersion(pipelineId, version, { graph: new Graph({ nodes, edges: current.graph.edges }) });
  }

  removeNode(pipelineId: string, version: number, nodeId: string): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    if (!current.graph.hasNode(nodeId)) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", `Node "${nodeId}" does not exist`, { pipelineId, version });
    }
    const nodes = [...current.graph.nodes.values()].filter((node) => node.id !== nodeId);
    const edges = current.graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
    return this.editVersion(pipelineId, version, { graph: new Graph({ nodes, edges }) });
  }

  addEdge(pipelineId: string, version: number, options: EdgeOptions): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    return this.editVersion(pipelineId, version, { graph: current.graph.addEdge(new Edge(options)) });
  }

  removeEdge(pipelineId: string, version: number, from: string, to: string): PipelineVersion {
    const current = this.pipelineService.getVersion(pipelineId, version);
    const edges = current.graph.edges.filter((edge) => edge.from !== from || edge.to !== to);
    return this.editVersion(pipelineId, version, { graph: new Graph({ nodes: [...current.graph.nodes.values()], edges }) });
  }

  editStateSchema(pipelineId: string, version: number, options: StateSchemaOptions): PipelineVersion {
    return this.editVersion(pipelineId, version, { stateSchema: new StateSchema(options) });
  }

  importDefinition(definition: PipelineDefinition): Pipeline {
    return this.createPipeline(pipelineFromDefinition(definition));
  }
}