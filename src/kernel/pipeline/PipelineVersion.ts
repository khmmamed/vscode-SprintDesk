import { DomainError } from "../DomainError.js";
import { Graph } from "../graph/Graph.js";
import { StateSchema } from "../state/StateSchema.js";

export interface PipelineVersionOptions {
  readonly version: number;
  readonly graph: Graph;
  readonly stateSchema: StateSchema;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class PipelineVersion {
  readonly version: number;
  readonly graph: Graph;
  readonly stateSchema: StateSchema;
  readonly metadata: Readonly<Record<string, unknown>>;

  constructor(options: PipelineVersionOptions) {
    if (!Number.isInteger(options.version) || options.version < 1) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Pipeline version must be a positive integer" });
    }
    this.version = options.version;
    this.graph = options.graph;
    this.stateSchema = options.stateSchema;
    this.metadata = Object.freeze({ ...options.metadata });
    Object.freeze(this);
  }
}