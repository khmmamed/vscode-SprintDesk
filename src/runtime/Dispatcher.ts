import { DomainError, type Execution } from "../kernel/index.js";
import type { EngineRunOptions, PipelineEngine } from "./PipelineEngine.js";
import type { Runtime } from "./Runtime.js";

export type DispatchStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type DispatchRequest = EngineRunOptions;

export interface DispatcherOptions {
  readonly engine: PipelineEngine;
  readonly runtime: Runtime;
  readonly maxConcurrentRuns?: number;
}

export interface DispatchStatusInfo {
  readonly id: string;
  readonly status: DispatchStatus;
  readonly pipelineId: string;
  readonly version?: number;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly runId?: string;
}

interface DispatchRecord {
  readonly id: string;
  status: DispatchStatus;
  readonly request: DispatchRequest;
  readonly pipelineId: string;
  readonly version?: number;
  readonly queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  runId?: string;
}

const TRANSITIONS: Readonly<Record<DispatchStatus, readonly DispatchStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

function canTransition(from: DispatchStatus, to: DispatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class Dispatcher {
  readonly engine: PipelineEngine;
  readonly runtime: Runtime;
  readonly maxConcurrentRuns: number;
  private readonly records = new Map<string, DispatchRecord>();
  private readonly order: string[] = [];

  constructor(options: DispatcherOptions) {
    validateCapacity(options.maxConcurrentRuns ?? 1);
    this.engine = options.engine;
    this.runtime = options.runtime;
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 1;
    Object.freeze(this);
  }

  dispatch(request: DispatchRequest): string {
    const record: DispatchRecord = {
      id: nextDispatchId(),
      status: "queued",
      request,
      pipelineId: request.pipelineId,
      version: request.version,
      queuedAt: Date.now(),
    };
    this.records.set(record.id, record);
    this.order.push(record.id);
    this.advance();
    return record.id;
  }

  status(id: string): DispatchStatusInfo {
    const record = this.requireRecord(id);
    return Object.freeze({
      id: record.id,
      status: record.status,
      pipelineId: record.pipelineId,
      version: record.version,
      queuedAt: record.queuedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      error: record.error,
      runId: record.runId,
    });
  }

  list(): readonly DispatchStatusInfo[] {
    return this.order.map((id) => this.status(id));
  }

  cancel(id: string): boolean {
    const record = this.requireRecord(id);
    if (record.status === "succeeded" || record.status === "failed" || record.status === "cancelled") {
      return false;
    }
    if (record.status === "queued") {
      this.transition(record, "cancelled");
      record.finishedAt = Date.now();
      return true;
    }
    if (record.runId === undefined) {
      return false;
    }
    return this.runtime.cancel(record.runId);
  }

  private advance(): void {
    if (this.runningCount() >= this.maxConcurrentRuns) {
      return;
    }
    const record = this.order
      .map((id) => this.records.get(id) as DispatchRecord)
      .find((candidate) => candidate.status === "queued");
    if (!record) {
      return;
    }
    this.admit(record);
    this.advance();
  }

  private admit(record: DispatchRecord): void {
    this.transition(record, "running");
    record.startedAt = Date.now();
    record.runId = record.request.id ?? nextRunId();
    const request: DispatchRequest = { ...record.request, id: record.runId };
    let promise: Promise<Execution>;
    try {
      promise = this.engine.run(request);
    } catch (error) {
      this.fail(record, error);
      return;
    }
    promise.then(
      (execution) => this.onSettled(record, execution),
      (error: unknown) => this.onRejected(record, error)
    );
  }

  private onSettled(record: DispatchRecord, execution: Execution): void {
    if (record.status !== "running") {
      return;
    }
    record.runId = execution.id;
    if (execution.status === "succeeded") {
      this.transition(record, "succeeded");
    } else if (execution.status === "cancelled") {
      this.transition(record, "cancelled");
    } else {
      this.transition(record, "failed");
      record.error = execution.run.error;
    }
    record.finishedAt = Date.now();
    this.advance();
  }

  private onRejected(record: DispatchRecord, error: unknown): void {
    if (record.status !== "running") {
      return;
    }
    this.fail(record, error);
  }

  private fail(record: DispatchRecord, error: unknown): void {
    this.transition(record, "failed");
    record.error = error instanceof Error ? error.message : String(error);
    record.finishedAt = Date.now();
    this.advance();
  }

  private runningCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.status === "running") {
        count += 1;
      }
    }
    return count;
  }

  private requireRecord(id: string): DispatchRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: `No dispatch request with id "${id}"`,
        details: { id },
      });
    }
    return record;
  }

  private transition(record: DispatchRecord, next: DispatchStatus): void {
    if (record.status === next || !canTransition(record.status, next)) {
      throw new DomainError({
        code: "ILLEGAL_TRANSITION",
        message: `Cannot transition dispatch request "${record.id}" from "${record.status}" to "${next}"`,
        details: { id: record.id, from: record.status, to: next },
      });
    }
    record.status = next;
  }
}

function validateCapacity(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError({
      code: "INVALID_INPUT",
      message: "maxConcurrentRuns must be a positive integer",
      details: { maxConcurrentRuns: value },
    });
  }
}

let dispatchSequence = 0;
function nextDispatchId(): string {
  dispatchSequence += 1;
  return `dispatch-${dispatchSequence}`;
}

let runSequence = 0;
function nextRunId(): string {
  runSequence += 1;
  return `run-${runSequence}`;
}