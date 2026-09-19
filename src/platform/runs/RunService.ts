import { State, type EventBus } from "../../kernel/index.js";
import type { PipelineEngine } from "../../runtime/index.js";
import type { Runtime, RunStatusInfo, StoredStateSnapshot } from "../../runtime/index.js";
import type { PipelineService } from "../pipelines/PipelineService.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export interface PlatformRunOptions {
  readonly pipelineId: string;
  readonly version?: number;
  readonly id?: string;
  readonly initialState?: State;
  readonly eventBus?: EventBus;
  readonly actor?: Principal | string;
}

export interface PlatformRunInfo {
  readonly id: string;
  readonly pipeline: { readonly id: string; readonly version?: number };
  readonly status: RunStatusInfo["status"];
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly nodes: RunStatusInfo["nodes"];
  readonly states: readonly StoredStateSnapshot[];
}

export interface PlatformRunFilters {
  readonly pipelineId?: string;
  readonly version?: number;
  readonly status?: RunStatusInfo["status"];
}

export class RunService {
  private readonly pipelineService: PipelineService;
  private readonly engine: PipelineEngine;
  private readonly runtime: Runtime;
  private readonly authorization?: AuthorizationService;

  constructor(
    pipelineService: PipelineService,
    engine: PipelineEngine,
    runtime: Runtime,
    authorization?: AuthorizationService
  ) {
    this.pipelineService = pipelineService;
    this.engine = engine;
    this.runtime = runtime;
    this.authorization = authorization;
  }

  async run(options: PlatformRunOptions): Promise<PlatformRunInfo> {
    this.authorization?.assertAllowed(options.actor, "run.start", { type: "run" });
    const version = this.pipelineService.requirePublished(options.pipelineId, options.version);
    const execution = await this.engine.run({
      pipelineId: options.pipelineId,
      version: version.version,
      id: options.id,
      initialState: options.initialState,
      eventBus: options.eventBus,
    });
    return this.toInfo(this.runtime.status(execution.id), options.pipelineId, version.version);
  }

  start(options: PlatformRunOptions): string {
    this.authorization?.assertAllowed(options.actor, "run.start", { type: "run" });
    const version = this.pipelineService.requirePublished(options.pipelineId, options.version);
    return this.engine.start({
      pipelineId: options.pipelineId,
      version: version.version,
      id: options.id,
      initialState: options.initialState,
      eventBus: options.eventBus,
    });
  }

  get(runId: string, actor?: Principal | string): PlatformRunInfo {
    this.authorization?.assertAllowed(actor, "run.read", { type: "run", id: runId });
    const status = this.runtime.status(runId);
    return this.toInfo(status, status.pipelineId ?? "unknown", status.pipelineVersion);
  }

  list(filters: PlatformRunFilters = {}, actor?: Principal | string): readonly PlatformRunInfo[] {
    this.authorization?.assertAllowed(actor, "run.read", { type: "run" });
    return this.runtime.runs()
      .filter((status) => filters.pipelineId === undefined || status.pipelineId === filters.pipelineId)
      .filter((status) => filters.version === undefined || status.pipelineVersion === filters.version)
      .filter((status) => filters.status === undefined || status.status === filters.status)
      .map((status) => this.toInfo(status, status.pipelineId ?? "unknown", status.pipelineVersion));
  }

  cancel(runId: string, actor?: Principal | string): boolean {
    this.authorization?.assertAllowed(actor, "run.cancel", { type: "run", id: runId });
    return this.runtime.cancel(runId);
  }

  private toInfo(status: RunStatusInfo, pipelineId: string, version?: number): PlatformRunInfo {
    const result = status.execution?.run.result?.finalState;
    return {
      id: status.id,
      pipeline: { id: pipelineId, version },
      status: status.status,
      startedAt: status.startedAt,
      finishedAt: status.finishedAt,
      error: status.error,
      result: result instanceof State ? result.value : result as Readonly<Record<string, unknown>> | undefined,
      nodes: status.nodes,
      states: status.states,
    };
  }
}