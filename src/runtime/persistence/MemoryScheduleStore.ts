import type { ScheduleStore, StoredSchedule } from "./ScheduleStore.js";

export class MemoryScheduleStore implements ScheduleStore {
  private readonly schedules = new Map<string, StoredSchedule>();

  save(schedule: StoredSchedule): void {
    this.schedules.set(schedule.id, { ...schedule });
  }

  get(scheduleId: string): StoredSchedule | null {
    return this.schedules.get(scheduleId) ?? null;
  }

  list(): StoredSchedule[] {
    return [...this.schedules.values()];
  }

  delete(scheduleId: string): void {
    this.schedules.delete(scheduleId);
  }
}