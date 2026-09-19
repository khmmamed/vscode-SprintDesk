import { DomainError, type PipelineVersion } from "../kernel/index.js";

export type ScheduleTrigger =
  | { readonly type: "manual" }
  | { readonly type: "interval"; readonly everyMs: number }
  | { readonly type: "event"; readonly eventType?: string };

export interface ScheduleOptions {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly trigger?: ScheduleTrigger;
  readonly enabled?: boolean;
  readonly createdAt?: number;
}

const MANUAL_TRIGGER: ScheduleTrigger = Object.freeze({ type: "manual" });

export class Schedule {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly trigger: ScheduleTrigger;
  readonly enabled: boolean;
  readonly createdAt: number;

  constructor(options: ScheduleOptions) {
    const id = options.id.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Schedule id must be a non-empty string" });
    }
    this.id = id;
    this.version = options.version;
    this.trigger = normalizeTrigger(options.trigger);
    this.enabled = options.enabled ?? true;
    this.createdAt = options.createdAt ?? Date.now();
    Object.freeze(this);
  }

  toString(): string {
    return `Schedule ${this.id} v${this.version.version}`;
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