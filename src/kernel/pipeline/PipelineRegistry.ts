import { DomainError } from "../DomainError.js";
import { Pipeline } from "./Pipeline.js";

export class PipelineRegistry {
  private readonly pipelines = new Map<string, Pipeline>();

  constructor() {
    Object.freeze(this);
  }

  register(pipeline: Pipeline): void {
    if (this.pipelines.has(pipeline.id)) {
      throw new DomainError({
        code: "DUPLICATE_ID",
        message: `Pipeline with id "${pipeline.id}" is already registered`,
      });
    }
    this.pipelines.set(pipeline.id, pipeline);
  }

  get(id: string): Pipeline {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) {
      throw new DomainError({
        code: "NOT_FOUND",
        message: `Pipeline with id "${id}" not found`,
      });
    }
    return pipeline;
  }

  has(id: string): boolean {
    return this.pipelines.has(id);
  }

  list(): readonly Pipeline[] {
    return Array.from(this.pipelines.values());
  }

  remove(id: string): boolean {
    return this.pipelines.delete(id);
  }
}