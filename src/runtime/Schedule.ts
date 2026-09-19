import { DomainError } from "../kernel/index.js";

export type ScheduleTrigger =
  | { readonly type: "manual" }
  | { readonly type: "interval"; readonly everyMs: number }
  | { readonly type: "event"; readonly eventType?: string };

export interface ScheduleOptions {
  readonly id: string;
  readonly pipelineId: string;
  readonly version?: number;
  readonly trigger?: ScheduleTrigger;
  readonly enabled?: boolean;
  readonly createdAt?: number;
}

const MANUAL_TRIGGER: ScheduleTrigger = Object.freeze({ type: "manual" });

export class Schedule {
  readonly id: string;
  readonly pipelineId: string;
  readonly version?: number;
  readonly trigger: ScheduleTrigger;
  readonly enabled: boolean;
  readonly createdAt: number;

  constructor(options: ScheduleOptions) {
    const id = options.id.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Schedule id must be a non-empty string" });
    }
    const pipelineId = options.pipelineId.trim();
    if (pipelineId.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Schedule pipelineId must be a non-empty string" });
    }
    if (options.version !== undefined && (!Number.isInteger(options.version) || options.version <= 0)) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: "Schedule version must be a positive integer when provided",
        details: { version: options.version },
      });
    }
    this.id = id;
    this.pipelineId = pipelineId;
    this.version = options.version;
    this.trigger = normalizeTrigger(options.trigger);
    this.enabled = options.enabled ?? true;
    this.createdAt = options.createdAt ?? Date.now();
    Object.freeze(this);
  }

  toString(): string {
    return `Schedule ${this.id} for ${this.pipelineId}${this.version !== undefined ? ` v${this.version}` : ""}`;
  }
}

function normalizeTrigger(trigger?: ScheduleTrigger): ScheduleTrigger {
  if (!trigger || trigger.type === "manual") {
    return MANUAL_TRIGGER;
  }
  if (trigger.type === "interval") {
    if (!(Number.isFinite(trigger.everyMs) && trigger.everyMs > 0)) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: "An interval schedule must have a positive finite everyMs in milliseconds",
        details: { everyMs: trigger.everyMs },
      });
    }
    return Object.freeze({ type: "interval", everyMs: trigger.everyMs });
  }
  if (trigger.eventType !== undefined) {
    const eventType = trigger.eventType.trim();
    if (eventType.length === 0) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: "An event trigger's eventType must be a non-empty string",
      });
    }
    return Object.freeze({ type: "event", eventType });
  }
  return Object.freeze({ type: "event" });
}