import { DomainError } from "../DomainError.js";
import type { RunStatus } from "./PipelineRun.js";
import type { RetryPolicy } from "../graph/RetryPolicy.js";

export type NodeRunStatus = RunStatus;

export type NodeFailureKind = "action" | "capability" | "resource";

export interface NodeAttempt {
  readonly attempt: number;
  readonly status: NodeRunStatus;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly failureKind?: NodeFailureKind;
}

export interface NodeRunOptions {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly status?: NodeRunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly stateVersion?: number;
  readonly failureKind?: NodeFailureKind;
  readonly attempts?: readonly NodeAttempt[];
  readonly retryPolicy?: RetryPolicy;
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
  readonly failureKind?: NodeFailureKind;
  readonly attempts: readonly NodeAttempt[];
  readonly retryPolicy?: RetryPolicy;

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
    this.failureKind = options.failureKind;
    this.attempts = Object.freeze([...(options.attempts ?? [])]);
    this.retryPolicy = options.retryPolicy;
    Object.freeze(this);
  }

  get currentAttempt(): number | undefined {
    if (this.attempts.length === 0) {
      return undefined;
    }
    return this.attempts[this.attempts.length - 1]?.attempt;
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
      failureKind: patch.failureKind ?? this.failureKind,
      attempts: patch.attempts ?? this.attempts,
      retryPolicy: patch.retryPolicy ?? this.retryPolicy,
    });
  }

  start(now: number = Date.now()): NodeRun {
    if (this.status !== "queued" && !(this.status === "running" && this.canStartNextAttempt())) {
      throw new DomainError({
        code: "ILLEGAL_TRANSITION",
        message: `Cannot start NodeRun "${this.nodeId}" from "${this.status}"`,
        details: { from: this.status, to: "running" },
      });
    }
    const attempt: NodeAttempt = { attempt: this.attempts.length + 1, status: "running", startedAt: now };
    return new NodeRun({
      nodeId: this.nodeId,
      nodeType: this.nodeType,
      status: "running",
      startedAt: this.startedAt ?? now,
      attempts: [...this.attempts, attempt],
      retryPolicy: this.retryPolicy,
    });
  }

  succeed(stateVersion?: number, now: number = Date.now()): NodeRun {
    return this.transition("succeeded", {
      stateVersion,
      finishedAt: now,
      attempts: this.closeLastAttempt({ status: "succeeded" }, now),
    });
  }

  fail(error: string, now: number = Date.now(), failureKind?: NodeFailureKind): NodeRun {
    return this.transition("failed", {
      error,
      finishedAt: now,
      failureKind,
      attempts: this.closeLastAttempt({ status: "failed", error, failureKind }, now),
    });
  }

  cancel(now: number = Date.now()): NodeRun {
    return this.transition("cancelled", {
      finishedAt: now,
      attempts: this.closeLastAttempt({ status: "cancelled" }, now),
    });
  }

  failAttempt(error: string, now: number = Date.now(), failureKind?: NodeFailureKind): NodeRun {
    if (this.status !== "running") {
      throw new DomainError({
        code: "ILLEGAL_TRANSITION",
        message: `Cannot record an attempt failure on NodeRun "${this.nodeId}" while "${this.status}"`,
        details: { from: this.status, to: "running" },
      });
    }
    return new NodeRun({
      nodeId: this.nodeId,
      nodeType: this.nodeType,
      status: "running",
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      stateVersion: this.stateVersion,
      failureKind: this.failureKind,
      attempts: this.closeLastAttempt({ status: "failed", error, failureKind }, now),
      retryPolicy: this.retryPolicy,
    });
  }

  private canStartNextAttempt(): boolean {
    const last = this.attempts[this.attempts.length - 1];
    return last !== undefined && last.status === "failed";
  }

  private closeLastAttempt(
    next: { readonly status: NodeRunStatus; readonly error?: string; readonly failureKind?: NodeFailureKind },
    now: number
  ): readonly NodeAttempt[] {
    const last = this.attempts[this.attempts.length - 1];
    if (last === undefined || last.status !== "running") {
      return this.attempts;
    }
    return [...this.attempts.slice(0, -1), { ...last, status: next.status, error: next.error, failureKind: next.failureKind, finishedAt: now }];
  }
}