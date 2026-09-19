import {
  DomainError,
  EventBus,
  Execution,
  PipelineVersion,
  State,
  type Event,
  type NodeFailureKind,
  type RunStatus,
} from "../kernel/index.js";
import { Executor, type ExecuteOptions } from "./Executor.js";
import { MemoryRunStore } from "./persistence/MemoryRunStore.js";
import {
  toStoredNodeRun,
  type RunStore,
  type StoredNodeRun,
  type StoredRun,
} from "./persistence/RunStore.js";

export const RUN_INTERRUPTED_ERROR = "Run was interrupted by system restart";

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
  readonly pipelineId?: string;
}

export interface RunStatusInfo {
  readonly id: string;
  readonly status: RuntimeRunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly pipelineId?: string;
  readonly pipelineVersion?: number;
  readonly nodes: readonly StoredNodeRun[];
  readonly execution?: Execution;
}

interface RunRecord {
  readonly id: string;
  readonly controller: AbortController;
  status: RuntimeRunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  pipelineId?: string;
  pipelineVersion?: number;
  nodeRuns: Map<string, StoredNodeRun>;
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
    this.recoverInterrupted();
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
      pipelineId: record.pipelineId,
      pipelineVersion: record.pipelineVersion,
      nodes: [...record.nodeRuns.values()],
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
    this.recoverInterrupted();
  }

  private recoverInterrupted(): void {
    for (const record of this.records.values()) {
      if (record.status !== "queued" && record.status !== "running") {
        continue;
      }
      const now = Date.now();
      record.status = "failed";
      record.error = RUN_INTERRUPTED_ERROR;
      record.finishedAt = now;
      for (const [nodeId, nodeRun] of record.nodeRuns) {
        if (nodeRun.status === "queued" || nodeRun.status === "running") {
          record.nodeRuns.set(nodeId, { ...nodeRun, status: "cancelled", finishedAt: now });
        }
      }
      this.persist(record);
    }
  }

  private register(id: string): RunRecord {
    if (this.records.has(id)) {
      throw new DomainError({ code: "DUPLICATE_ID", message: `A run with id "${id}" is already tracked` });
    }
    const record: RunRecord = { id, controller: new AbortController(), status: "queued", nodeRuns: new Map() };
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
      pipelineId: stored.pipelineId,
      pipelineVersion: stored.pipelineVersion,
      nodeRuns: new Map((stored.nodes ?? []).map((nodeRun) => [nodeRun.nodeId, nodeRun])),
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
      pipelineId: record.pipelineId,
      pipelineVersion: record.pipelineVersion,
      nodes: [...record.nodeRuns.values()],
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
    const onNodeStarted = bus.subscribe("execution.node.started", (event: Event) => {
      if (event.payload.executionId === runId) {
        record.nodeRuns.set(event.payload.nodeId as string, {
          nodeId: event.payload.nodeId as string,
          nodeType: event.payload.nodeType as string,
          status: "running",
          startedAt: Date.now(),
        });
        this.persist(record);
      }
    });
    const onNodeFinished = bus.subscribe("execution.node.finished", (event: Event) => {
      if (event.payload.executionId === runId) {
        const existing = record.nodeRuns.get(event.payload.nodeId as string);
        record.nodeRuns.set(event.payload.nodeId as string, {
          nodeId: event.payload.nodeId as string,
          nodeType: existing?.nodeType ?? "unknown",
          status: "succeeded",
          startedAt: existing?.startedAt,
          finishedAt: Date.now(),
          stateVersion: event.payload.stateVersion as number,
        });
        this.persist(record);
      }
    });
    const onNodeFailed = bus.subscribe("execution.node.failed", (event: Event) => {
      if (event.payload.executionId === runId) {
        const existing = record.nodeRuns.get(event.payload.nodeId as string);
        record.nodeRuns.set(event.payload.nodeId as string, {
          nodeId: event.payload.nodeId as string,
          nodeType: existing?.nodeType ?? "unknown",
          status: "failed",
          startedAt: existing?.startedAt,
          finishedAt: Date.now(),
          error: event.payload.error === undefined ? undefined : String(event.payload.error),
          ...(event.payload.kind !== undefined ? { failureKind: event.payload.kind as NodeFailureKind } : {}),
        });
        this.persist(record);
      }
    });
    const onNodeCancelled = bus.subscribe("execution.node.cancelled", (event: Event) => {
      if (event.payload.executionId === runId) {
        const existing = record.nodeRuns.get(event.payload.nodeId as string);
        record.nodeRuns.set(event.payload.nodeId as string, {
          nodeId: event.payload.nodeId as string,
          nodeType: existing?.nodeType ?? "unknown",
          status: "cancelled",
          startedAt: existing?.startedAt,
          finishedAt: Date.now(),
        });
        this.persist(record);
      }
    });
    return () => {
      onStarted();
      onFinished();
      onFailed();
      onCancelled();
      onNodeStarted();
      onNodeFinished();
      onNodeFailed();
      onNodeCancelled();
    };
  }

  private async run(version: PipelineVersion, record: RunRecord, options: RuntimeRunOptions): Promise<Execution> {
    record.pipelineId = options.pipelineId;
    record.pipelineVersion = version.version;
    const executeOptions: ExecuteOptions = {
      id: record.id,
      initialState: options.initialState,
      eventBus: options.eventBus ?? this.eventBus,
      signal: record.controller.signal,
      pipelineId: record.pipelineId,
      pipelineVersion: version.version,
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
    record.pipelineVersion = execution.version.version;
    record.nodeRuns = new Map(
      [...execution.nodes.values()].map((nodeRun) => [nodeRun.nodeId, toStoredNodeRun(nodeRun)])
    );
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