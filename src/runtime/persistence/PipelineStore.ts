import { DomainError, Pipeline } from "../../kernel/index.js";
import {
  fromStoredPipelineVersion,
  toStoredPipelineVersion,
  type StoredPipelineVersion,
} from "./ScheduleStore.js";

export interface StoredPipeline {
  readonly id: string;
  readonly name: string;
  readonly versions: readonly StoredPipelineVersion[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PipelineStore {
  save(pipeline: StoredPipeline): void;
  get(pipelineId: string): StoredPipeline | null;
  list(): StoredPipeline[];
  delete(pipelineId: string): void;
}

export function toStoredPipeline(pipeline: Pipeline): StoredPipeline {
  return {
    id: pipeline.id,
    name: pipeline.name,
    versions: pipeline.versions.map(toStoredPipelineVersion),
    metadata: pipeline.metadata,
  };
}

export function parseStoredPipeline(value: unknown): StoredPipeline {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a pipeline object");
  }
  const pipeline = value as Record<string, unknown>;
  if (typeof pipeline.id !== "string" || pipeline.id.trim().length === 0) {
    throw malformed("id must be a non-empty string");
  }
  if (typeof pipeline.name !== "string" || pipeline.name.trim().length === 0) {
    throw malformed("name must be a non-empty string");
  }
  if (!Array.isArray(pipeline.versions)) {
    throw malformed("versions must be an array");
  }
  const stored = value as unknown as StoredPipeline;
  fromStoredPipeline(stored);
  return stored;
}

export function fromStoredPipeline(stored: StoredPipeline): Pipeline {
  try {
    return new Pipeline({
      id: stored.id,
      name: stored.name,
      versions: stored.versions.map(fromStoredPipelineVersion),
      metadata: stored.metadata,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw malformed(`pipeline "${stored.id}": ${error.message}`);
    }
    throw error;
  }
}

function malformed(message: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed persisted pipeline data: ${message}`,
    details: { message },
  });
}