import { DomainError } from "../DomainError.js";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface PipelineRunOptions {
  readonly id: string;
  readonly status?: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class PipelineRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;

  constructor(options: PipelineRunOptions) {
    const id = options.id.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "PipelineRun id must be a non-empty string" });
    }
    this.id = id;
    this.status = options.status ?? "queued";
    this.startedAt = options.startedAt;
    this.finishedAt = options.finishedAt;
    this.error = options.error;
    this.result = options.result ? Object.freeze({ ...options.result }) : undefined;
    Object.freeze(this);
  }

  canTransitionTo(next: RunStatus): boolean {
    return TRANSITIONS[this.status].includes(next);
  }

  private transition(next: RunStatus, patch: Partial<Omit<PipelineRunOptions, "id" | "status">>): PipelineRun {
    if (!this.canTransitionTo(next)) {
      throw new DomainError({
        code: "ILLEGAL_TRANSITION",
        message: `Cannot transition PipelineRun "${this.id}" from "${this.status}" to "${next}"`,
        details: { from: this.status, to: next },
      });
    }
    return new PipelineRun({
      id: this.id,
      status: next,
      startedAt: patch.startedAt ?? this.startedAt,
      finishedAt: patch.finishedAt ?? this.finishedAt,
      error: patch.error ?? this.error,
      result: patch.result ?? this.result,
    });
  }

  start(now: number = Date.now()): PipelineRun {
    return this.transition("running", { startedAt: now });
  }

  succeed(result?: Readonly<Record<string, unknown>>, now: number = Date.now()): PipelineRun {
    return this.transition("succeeded", { result, finishedAt: now });
  }

  fail(error: string, now: number = Date.now()): PipelineRun {
    return this.transition("failed", { error, finishedAt: now });
  }

  cancel(now: number = Date.now()): PipelineRun {
    return this.transition("cancelled", { finishedAt: now });
  }
}