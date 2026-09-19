import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "../../kernel/index.js";
import { parseStoredRun, type RunStore, type StoredRun } from "./RunStore.js";

export interface FileRunStoreOptions {
  readonly filePath: string;
}

export class FileRunStore implements RunStore {
  private readonly filePath: string;
  private readonly runs = new Map<string, StoredRun>();

  constructor(options: FileRunStoreOptions) {
    this.filePath = options.filePath;
    mkdirSync(dirname(this.filePath), { recursive: true });
    for (const run of loadRuns(this.filePath)) {
      this.runs.set(run.id, run);
    }
  }

  save(run: StoredRun): void {
    this.runs.set(run.id, { ...run });
    this.write();
  }

  get(runId: string): StoredRun | null {
    return this.runs.get(runId) ?? null;
  }

  list(): StoredRun[] {
    return [...this.runs.values()];
  }

  delete(runId: string): void {
    if (this.runs.delete(runId)) {
      this.write();
    }
  }

  private write(): void {
    writeFileSync(this.filePath, JSON.stringify({ version: 1, runs: [...this.runs.values()] }, null, 2), "utf8");
  }
}

function loadRuns(filePath: string): StoredRun[] {
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
    throw malformedFile(filePath, 'expected an object with a "runs" array');
  }
  const runs = (parsed as { runs?: unknown[] }).runs;
  if (!Array.isArray(runs)) {
    throw malformedFile(filePath, 'expected an object with a "runs" array');
  }
  try {
    return runs.map(parseStoredRun);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
}

function malformedFile(filePath: string, detail: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed run store file "${filePath}": ${detail}`,
    details: { filePath, detail },
  });
}