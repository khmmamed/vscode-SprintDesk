import type { Pipeline } from "../../kernel/index.js";
import {
  fromStoredPipeline,
  parseStoredPipeline,
  toStoredPipeline,
  type StoredPipeline,
} from "../../runtime/persistence/PipelineStore.js";

/** The canonical JSON-compatible pipeline representation used by platform authors. */
export type PipelineDefinition = StoredPipeline;

export function parsePipelineDefinition(value: unknown): PipelineDefinition {
  return parseStoredPipeline(value);
}

export function pipelineToDefinition(pipeline: Pipeline): PipelineDefinition {
  const jsonCompatible = JSON.parse(JSON.stringify(toStoredPipeline(pipeline))) as unknown;
  return parseStoredPipeline(jsonCompatible);
}

export function pipelineFromDefinition(definition: PipelineDefinition): Pipeline {
  return fromStoredPipeline(definition);
}

export function stringifyPipelineDefinition(definition: PipelineDefinition): string {
  return JSON.stringify(parsePipelineDefinition(definition));
}

export function parsePipelineJson(json: string): PipelineDefinition {
  return parsePipelineDefinition(JSON.parse(json) as unknown);
}