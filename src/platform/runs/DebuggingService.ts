import type { Event } from "../../kernel/index.js";
import type { EventBus } from "../../kernel/index.js";
import type { ArtifactInfo, ArtifactService } from "../artifacts/ArtifactService.js";
import type { RunControlInfo, RunControlService } from "./RunControlService.js";
import type { PlatformRunInfo } from "./RunService.js";
import type { StoredStateSnapshot } from "../../runtime/index.js";

export interface DebugTimeline {
  readonly run: RunControlInfo;
  readonly events: readonly Event[];
  readonly states: readonly StoredStateSnapshot[];
  readonly artifacts: readonly ArtifactInfo[];
}

export interface FailureContext {
  readonly run: RunControlInfo;
  readonly nodeId?: string;
  readonly error?: string;
  readonly events: readonly Event[];
}

export class DebuggingService {
  constructor(
    private readonly eventBus: EventBus | undefined,
    private readonly runs: RunControlService,
    private readonly artifacts: ArtifactService
  ) {}

  timeline(runId: string): DebugTimeline {
    const run = this.runs.get(runId);
    return {
      run,
      events: this.events(runId),
      states: this.stateSnapshots(runId),
      artifacts: this.artifacts.byExecution(runId),
    };
  }

  events(runId: string, type?: string): readonly Event[] {
    return (this.eventBus?.history() ?? []).filter((event) =>
      event.payload.executionId === runId && (type === undefined || event.type === type)
    );
  }

  stateSnapshots(runId: string): readonly StoredStateSnapshot[] {
    return this.runs.get(runId).states;
  }

  stateAfterNode(runId: string, nodeId: string): Readonly<Record<string, unknown>> | undefined {
    const snapshot = this.stateSnapshots(runId).find((candidate) => candidate.nodeId === nodeId);
    return snapshot?.value;
  }

  failureContext(runId: string): FailureContext {
    const run = this.runs.get(runId);
    const events = this.events(runId);
    const failedNode = run.nodes.find((node) => node.status === "failed");
    return {
      run,
      nodeId: failedNode?.nodeId,
      error: failedNode?.error ?? run.error,
      events,
    };
  }
}