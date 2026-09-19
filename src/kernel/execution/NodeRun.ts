import { DomainError } from "../DomainError.js";
import type { RunStatus } from "./PipelineRun.js";

export type NodeRunStatus = RunStatus;

export interface NodeRunOptions {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly status?: NodeRunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly stateVersion?: number;
}

const TRANSITIONS: Readonly<Record<NodeRunStatus, readonly NodeRunStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class NodeRun {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly status: NodeRunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly stateVersion?: number;

  constructor(options: NodeRunOptions) {
    const nodeId = options.nodeId.trim();
    if (nodeId.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "NodeRun nodeId must be a non-empty string" });
    }
    const nodeType = options.nodeType.trim();
    if (nodeType.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "NodeRun nodeType must be a non-empty string" });
    }
    this.nodeId = nodeId;
    this.nodeType = nodeType;
    this.status = options.status ?? "queued";
    this.startedAt = options.startedAt;
    this.finishedAt = options.finishedAt;
    this.error = options.error;
    this.stateVersion = options.stateVersion;
    Object.freeze(this);
  }

  canTransitionTo(next: NodeRunStatus): boolean {
    return TRANSITIONS[this.status].includes(next);
  }

  private transition(next: NodeRunStatus, patch: Partial<Omit<NodeRunOptions, "nodeId" | "nodeType" | "status">>): NodeRun {
    if (!this.canTransitionTo(next)) {
      throw new DomainError({
        code: "ILLEGAL_TRANSITION",
        message: `Cannot transition NodeRun "${this.nodeId}" from "${this.status}" to "${next}"`,
        details: { from: this.status, to: next },
      });
    }
    return new NodeRun({
      nodeId: this.nodeId,
      nodeType: this.nodeType,
      status: next,
      startedAt: patch.startedAt ?? this.startedAt,
      finishedAt: patch.finishedAt ?? this.finishedAt,
      error: patch.error ?? this.error,
      stateVersion: patch.stateVersion ?? this.stateVersion,
    });
  }

  start(now: number = Date.now()): NodeRun {
    return this.transition("running", { startedAt: now });
  }

  succeed(stateVersion?: number, now: number = Date.now()): NodeRun {
    return this.transition("succeeded", { stateVersion, finishedAt: now });
  }

  fail(error: string, now: number = Date.now()): NodeRun {
    return this.transition("failed", { error, finishedAt: now });
  }

  cancel(now: number = Date.now()): NodeRun {
    return this.transition("cancelled", { finishedAt: now });
  }
}