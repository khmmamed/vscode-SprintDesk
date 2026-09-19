import { DomainError, type RunStatus } from "../../kernel/index.js";

export interface StoredRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface RunStore {
  save(run: StoredRun): void;
  get(runId: string): StoredRun | null;
  list(): StoredRun[];
  delete(runId: string): void;
}

const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

export function parseStoredRun(value: unknown): StoredRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a run object");
  }
  const run = value as Record<string, unknown>;
  if (typeof run.id !== "string" || run.id.trim().length === 0) {
    throw malformed("id must be a non-empty string");
  }
  if (typeof run.status !== "string" || !RUN_STATUSES.includes(run.status as RunStatus)) {
    throw malformed(`status must be one of ${RUN_STATUSES.join(", ")}`);
  }
  const stored: MutableRun = { id: run.id, status: run.status as RunStatus };
  if (run.startedAt !== undefined) {
    if (typeof run.startedAt !== "number" || !Number.isFinite(run.startedAt)) {
      throw malformed("startedAt must be a finite number");
    }
    stored.startedAt = run.startedAt;
  }
  if (run.finishedAt !== undefined) {
    if (typeof run.finishedAt !== "number" || !Number.isFinite(run.finishedAt)) {
      throw malformed("finishedAt must be a finite number");
    }
    stored.finishedAt = run.finishedAt;
  }
  if (run.error !== undefined) {
    if (typeof run.error !== "string") {
      throw malformed("error must be a string");
    }
    stored.error = run.error;
  }
  if (run.result !== undefined) {
    if (typeof run.result !== "object" || run.result === null || Array.isArray(run.result)) {
      throw malformed("result must be an object");
    }
    stored.result = run.result as StoredRun["result"];
  }
  return stored;
}

type MutableRun = {
  id: string;
  status: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: Readonly<Record<string, unknown>>;
};

function malformed(message: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed persisted run data: ${message}`,
    details: { message },
  });
}