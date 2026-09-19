import type { ArtifactInfo, ArtifactService } from "../artifacts/ArtifactService.js";
import type { PipelineService } from "../pipelines/PipelineService.js";
import {
  RunService,
  type PlatformRunFilters,
  type PlatformRunInfo,
} from "./RunService.js";

export type RunControlNodeInfo = PlatformRunInfo["nodes"][number] & {
  readonly durationMs?: number;
};

export interface RunControlFilters extends PlatformRunFilters {
  readonly activeOnly?: boolean;
  readonly query?: string;
}

export interface RunControlInfo {
  readonly id: string;
  readonly pipeline: { readonly id: string; readonly name?: string; readonly version?: number };
  readonly status: PlatformRunInfo["status"];
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly nodes: readonly RunControlNodeInfo[];
  readonly states: PlatformRunInfo["states"];
  readonly stateVersions: readonly number[];
  readonly artifacts: readonly ArtifactInfo[];
}

export class RunControlService {
  constructor(
    private readonly runs: RunService,
    private readonly pipelines: PipelineService,
    private readonly artifacts: ArtifactService
  ) {}

  get(runId: string): RunControlInfo {
    return this.toInfo(this.runs.get(runId));
  }

  list(filters: RunControlFilters = {}): readonly RunControlInfo[] {
    return this.runs.list(filters)
      .map((run) => this.toInfo(run))
      .filter((run) => !filters.activeOnly || run.status === "queued" || run.status === "running")
      .filter((run) => filters.query === undefined || this.matches(run, filters.query));
  }

  active(): readonly RunControlInfo[] {
    return this.list({ activeOnly: true });
  }

  historical(): readonly RunControlInfo[] {
    return this.list({ activeOnly: false }).filter((run) => run.status !== "queued" && run.status !== "running");
  }

  cancel(runId: string): boolean {
    return this.runs.cancel(runId);
  }

  private toInfo(run: PlatformRunInfo): RunControlInfo {
    const pipeline = this.pipelines.registry.get(run.pipeline.id);
    const nodes = run.nodes.map((node) => ({
      ...node,
      durationMs: duration(node.startedAt, node.finishedAt),
    }));
    return {
      id: run.id,
      pipeline: { id: run.pipeline.id, name: pipeline.name, version: run.pipeline.version },
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: duration(run.startedAt, run.finishedAt),
      error: run.error,
      result: run.result,
      nodes,
      states: run.states,
      stateVersions: nodes
        .map((node) => node.stateVersion)
        .filter((version): version is number => version !== undefined),
      artifacts: this.artifacts.byExecution(run.id),
    };
  }

  private matches(run: RunControlInfo, query: string): boolean {
    const normalized = query.toLowerCase();
    return run.id.toLowerCase().includes(normalized) ||
      run.pipeline.id.toLowerCase().includes(normalized) ||
      (run.pipeline.name?.toLowerCase().includes(normalized) ?? false) ||
      run.nodes.some((node) => node.nodeId.toLowerCase().includes(normalized));
  }
}

function duration(startedAt?: number, finishedAt?: number): number | undefined {
  if (startedAt === undefined) {
    return undefined;
  }
  return Math.max(0, (finishedAt ?? Date.now()) - startedAt);
}