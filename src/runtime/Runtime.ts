import {
  DomainError,
  EventBus,
  Execution,
  PipelineVersion,
  State,
  type Event,
  type RunStatus,
} from "../kernel/index.js";
import { Executor, type ExecuteOptions } from "./Executor.js";
import { MemoryRunStore } from "./persistence/MemoryRunStore.js";
import type { RunStore, StoredRun } from "./persistence/RunStore.js";

export type RuntimeRunStatus = RunStatus;

export interface RuntimeOptions {
  readonly executor: Executor;
  readonly eventBus?: EventBus;
  readonly runStore?: RunStore;
}

export interface RuntimeRunOptions {
  readonly id?: string;
  readonly initialState?: State;
  readonly eventBus?: EventBus;
}

export interface RunStatusInfo {
  readonly id: string;
  readonly status: RuntimeRunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly execution?: Execution;
}

interface RunRecord {
  readonly id: string;
  readonly controller: AbortController;
  status: RuntimeRunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  execution?: Execution;
  unsubscribe?: () => void;
}

export class Runtime {
  readonly executor: Executor;
  readonly eventBus?: EventBus;
  readonly runStore: RunStore;
  private readonly records = new Map<string, RunRecord>();

  constructor(options: RuntimeOptions) {
    this.executor = options.executor;
    this.eventBus = options.eventBus;
    this.runStore = options.runStore ?? new MemoryRunStore();
    for (const stored of this.runStore.list()) {
      this.hydrate(stored);
    }
  }

  start(version: PipelineVersion, options: RuntimeRunOptions = {}): string {
    const id = options.id ?? nextRunId();
    const record = this.register(id);
    const bus = options.eventBus ?? this.eventBus;
    if (bus) {
      record.unsubscribe = this.follow(bus, id, record);
      bus.publish("runtime.run.started", { runId: id });
    }
    void this.run(version, record, options).catch(() => {
      // Fire-and-forget: failures are reflected on the tracked run.
    });
    return id;
  }

  async execute(version: PipelineVersion, options: RuntimeRunOptions = {}): Promise<Execution> {
    const id = options.id ?? nextRunId();
    const record = this.register(id);
    const bus = options.eventBus ?? this.eventBus;
    if (bus) {
      record.unsubscribe = this.follow(bus, id, record);
      bus.publish("runtime.run.started", { runId: id });
    }
    return this.run(version, record, options);
  }

  status(id: string): RunStatusInfo {
    const record = this.records.get(id);
    if (!record) {
      throw new DomainError({ code: "INVALID_INPUT", message: `No run with id "${id}"` });
    }
    return Object.freeze({
      id: record.id,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      error: record.error,
      execution: record.execution,
    });
  }

  runs(): readonly RunStatusInfo[] {
    return [...this.records.values()].map((record) => this.status(record.id));
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record) {
      throw new DomainError({ code: "INVALID_INPUT", message: `No run with id "${id}"` });
    }
    if (record.status === "succeeded" || record.status === "failed" || record.status === "cancelled") {
      return false;
    }
    if (record.execution) {
      const runStatus = record.execution.status;
      if (runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled") {
        return false;
      }
    }
    if (record.status === "queued") {
      record.status = "cancelled";
      this.persist(record);
    }
    record.controller.abort();
    return true;
  }

  async recover(): Promise<void> {
    for (const record of this.records.values()) {
      if (record.status === "queued" || record.status === "running") {
        record.status = "failed";
        record.error = "Run was interrupted by system restart";
        record.finishedAt = Date.now();
        this.persist(record);
      }
    }
  }

  private register(id: string): RunRecord {
    if (this.records.has(id)) {
      throw new DomainError({ code: "DUPLICATE_ID", message: `A run with id "${id}" is already tracked` });
    }
    const record: RunRecord = { id, controller: new AbortController(), status: "queued" };
    this.records.set(id, record);
    this.persist(record);
    return record;
  }

  private hydrate(stored: StoredRun): void {
    const record: RunRecord = {
      id: stored.id,
      controller: new AbortController(),
      status: stored.status,
      startedAt: stored.startedAt,
      finishedAt: stored.finishedAt,
      error: stored.error,
    };
    this.records.set(record.id, record);
  }

  private persist(record: RunRecord): void {
    this.runStore.save(this.toStoredRun(record));
  }

  private toStoredRun(record: RunRecord): StoredRun {
    return {
      id: record.id,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      error: record.error,
      result: durableResult(record.execution),
    };
  }

  private follow(bus: EventBus, runId: string, record: RunRecord): () => void {
    const onStarted = bus.subscribe("execution.run.started", (event: Event) => {
      if (event.payload.executionId === runId) {
        record.status = "running";
        record.startedAt = record.startedAt ?? Date.now();
        this.persist(record);
      }
    });
    const onFinished = bus.subscribe("execution.run.finished", (event: Event) => {
      if (event.payload.executionId === runId && !record.execution) {
        record.status = "succeeded";
        record.finishedAt = Date.now();
        this.persist(record);
      }
    });
    const onFailed = bus.subscribe("execution.run.failed", (event: Event) => {
      if (event.payload.executionId === runId && !record.execution) {
        record.status = "failed";
        record.finishedAt = Date.now();
        record.error = event.payload.error === undefined ? undefined : String(event.payload.error);
        this.persist(record);
      }
    });
    const onCancelled = bus.subscribe("execution.run.cancelled", (event: Event) => {
      if (event.payload.executionId === runId && !record.execution) {
        record.status = "cancelled";
        record.finishedAt = Date.now();
        this.persist(record);
      }
    });
    return () => {
      onStarted();
      onFinished();
      onFailed();
      onCancelled();
    };
  }

  private async run(version: PipelineVersion, record: RunRecord, options: RuntimeRunOptions): Promise<Execution> {
    const executeOptions: ExecuteOptions = {
      id: record.id,
      initialState: options.initialState,
      eventBus: options.eventBus ?? this.eventBus,
      signal: record.controller.signal,
    };
    try {
      const execution = await this.executor.execute(version, executeOptions);
      this.complete(record, execution);
      return execution;
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.unsubscribe?.();
      record.unsubscribe = undefined;
      this.persist(record);
      throw error;
    }
  }

  private complete(record: RunRecord, execution: Execution): void {
    record.execution = execution;
    record.status = execution.status;
    record.startedAt = execution.run.startedAt;
    record.finishedAt = execution.run.finishedAt;
    record.error = execution.run.error;
    record.unsubscribe?.();
    record.unsubscribe = undefined;
    this.persist(record);
  }
}

let sequence = 0;
function nextRunId(): string {
  sequence += 1;
  return `run-${sequence}`;
}

function durableResult(execution?: Execution): Readonly<Record<string, unknown>> | undefined {
  const result = execution?.run.result;
  if (result === undefined) {
    return undefined;
  }
  const finalState = result.finalState;
  return { finalState: finalState instanceof State ? finalState.value : finalState };
}