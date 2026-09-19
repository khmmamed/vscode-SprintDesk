import type { PipelineStore, StoredPipeline } from "./PipelineStore.js";

export class MemoryPipelineStore implements PipelineStore {
  private readonly pipelines = new Map<string, StoredPipeline>();

  save(pipeline: StoredPipeline): void {
    this.pipelines.set(pipeline.id, { ...pipeline });
  }

  get(pipelineId: string): StoredPipeline | null {
    return this.pipelines.get(pipelineId) ?? null;
  }

  list(): StoredPipeline[] {
    return [...this.pipelines.values()];
  }

  delete(pipelineId: string): void {
    this.pipelines.delete(pipelineId);
  }
}