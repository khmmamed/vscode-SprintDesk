import { DomainError, EventBus, type Event, type Unsubscribe } from "../kernel/index.js";
import type { Dispatcher } from "./Dispatcher.js";
import type { RuntimeRunOptions } from "./Runtime.js";
import { Schedule, type ScheduleTrigger } from "./Schedule.js";
import { MemoryScheduleStore } from "./persistence/MemoryScheduleStore.js";
import {
  fromStoredSchedule,
  toStoredSchedule,
  type ScheduleStore,
} from "./persistence/ScheduleStore.js";

export interface ScheduleDefinition {
  readonly id?: string;
  readonly pipelineId: string;
  readonly version?: number;
  readonly trigger?: ScheduleTrigger;
  readonly enabled?: boolean;
  readonly createdAt?: number;
}

export interface SchedulerOptions {
  readonly dispatcher: Dispatcher;
  readonly eventBus?: EventBus;
  readonly scheduleStore?: ScheduleStore;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class Scheduler {
  readonly dispatcher: Dispatcher;
  readonly scheduleStore: ScheduleStore;
  private readonly schedules = new Map<string, Schedule>();
  private readonly timers = new Map<string, TimerHandle>();
  private readonly subscriptions = new Map<string, Unsubscribe>();
  private readonly eventBus?: EventBus;
  private running = true;

  constructor(options: SchedulerOptions) {
    this.dispatcher = options.dispatcher;
    this.eventBus = options.eventBus;
    this.scheduleStore = options.scheduleStore ?? new MemoryScheduleStore();
    this.hydrate();
  }

  private hydrate(): void {
    for (const stored of this.scheduleStore.list()) {
      const schedule = fromStoredSchedule(stored);
      this.schedules.set(schedule.id, schedule);
      this.arm(schedule);
      this.listen(schedule);
    }
  }

  schedule(definition: ScheduleDefinition): Schedule {
    const id = definition.id ?? nextScheduleId();
    if (this.schedules.has(id)) {
      throw new DomainError({ code: "DUPLICATE_ID", message: `A schedule with id "${id}" is already registered` });
    }
    const schedule = new Schedule({
      id,
      pipelineId: definition.pipelineId,
      version: definition.version,
      trigger: definition.trigger,
      enabled: definition.enabled,
      createdAt: definition.createdAt,
    });
    this.scheduleStore.save(toStoredSchedule(schedule));
    this.schedules.set(id, schedule);
    this.arm(schedule);
    this.listen(schedule);
    return schedule;
  }

  unschedule(id: string): boolean {
    if (!this.schedules.has(id)) {
      return false;
    }
    this.clearTimer(id);
    this.clearSubscription(id);
    this.scheduleStore.delete(id);
    return this.schedules.delete(id);
  }

  get(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  list(): readonly Schedule[] {
    return [...this.schedules.values()];
  }

  trigger(id: string, options?: RuntimeRunOptions): string {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      throw new DomainError({ code: "INVALID_INPUT", message: `No schedule with id "${id}"` });
    }
    return this.dispatcher.dispatch({
      pipelineId: schedule.pipelineId,
      version: schedule.version,
      id: options?.id,
      initialState: options?.initialState,
      eventBus: options?.eventBus,
    });
  }

  start(): void {
    this.running = true;
    for (const schedule of this.schedules.values()) {
      this.arm(schedule);
      this.listen(schedule);
    }
  }

  stop(): void {
    this.running = false;
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id);
    }
    for (const id of [...this.subscriptions.keys()]) {
      this.clearSubscription(id);
    }
  }

  private arm(schedule: Schedule): void {
    if (!this.running || !schedule.enabled) {
      return;
    }
    if (schedule.trigger.type !== "interval") {
      return;
    }
    if (this.timers.has(schedule.id)) {
      return;
    }
    const timer = setTimeout(() => this.fire(schedule), schedule.trigger.everyMs);
    this.timers.set(schedule.id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private listen(schedule: Schedule): void {
    if (!this.running || !schedule.enabled || !this.eventBus) {
      return;
    }
    if (schedule.trigger.type !== "event") {
      return;
    }
    if (this.subscriptions.has(schedule.id)) {
      return;
    }
    const handler = (event: Event): void => {
      const trigger = schedule.trigger;
      if (trigger.type === "event") {
        const matches = trigger.eventType === undefined || event.type === trigger.eventType;
        if (matches) {
          this.request(schedule);
        }
      }
    };
    const unsubscribe =
      schedule.trigger.eventType === undefined
        ? this.eventBus.onAny(handler)
        : this.eventBus.subscribe(schedule.trigger.eventType, handler);
    this.subscriptions.set(schedule.id, unsubscribe);
  }

  private clearSubscription(id: string): void {
    const unsubscribe = this.subscriptions.get(id);
    if (unsubscribe !== undefined) {
      unsubscribe();
      this.subscriptions.delete(id);
    }
  }

  private fire(schedule: Schedule): void {
    this.clearTimer(schedule.id);
    this.arm(schedule);
    this.request(schedule);
  }

  private request(schedule: Schedule): void {
    try {
      this.dispatcher.dispatch({ pipelineId: schedule.pipelineId, version: schedule.version });
    } catch {
      // A failing request must not break the scheduler loop.
    }
  }
}

let sequence = 0;
function nextScheduleId(): string {
  sequence += 1;
  return `schedule-${sequence}`;
}