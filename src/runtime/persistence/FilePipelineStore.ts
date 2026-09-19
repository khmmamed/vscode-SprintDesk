import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "../../kernel/index.js";
import { parseStoredPipeline, type PipelineStore, type StoredPipeline } from "./PipelineStore.js";

export interface FilePipelineStoreOptions {
  readonly filePath: string;
}

export class FilePipelineStore implements PipelineStore {
  private readonly filePath: string;
  private readonly pipelines = new Map<string, StoredPipeline>();

  constructor(options: FilePipelineStoreOptions) {
    this.filePath = options.filePath;
    mkdirSync(dirname(this.filePath), { recursive: true });
    for (const pipeline of loadPipelines(this.filePath)) {
      this.pipelines.set(pipeline.id, pipeline);
    }
  }

  save(pipeline: StoredPipeline): void {
    this.pipelines.set(pipeline.id, { ...pipeline });
    this.write();
  }

  get(pipelineId: string): StoredPipeline | null {
    return this.pipelines.get(pipelineId) ?? null;
  }

  list(): StoredPipeline[] {
    return [...this.pipelines.values()];
  }

  delete(pipelineId: string): void {
    if (this.pipelines.delete(pipelineId)) {
      this.write();
    }
  }

  private write(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify({ version: 1, pipelines: [...this.pipelines.values()] }, null, 2),
      "utf8"
    );
  }
}

function loadPipelines(filePath: string): StoredPipeline[] {
  if (!existsSync(filePath)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (raw.trim().length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw malformedFile(filePath, 'expected an object with a "pipelines" array');
  }
  const pipelines = (parsed as { pipelines?: unknown[] }).pipelines;
  if (!Array.isArray(pipelines)) {
    throw malformedFile(filePath, 'expected an object with a "pipelines" array');
  }
  try {
    return pipelines.map(parseStoredPipeline);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
}

function malformedFile(filePath: string, detail: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed pipeline store file "${filePath}": ${detail}`,
    details: { filePath, detail },
  });
}