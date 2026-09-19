import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "../../kernel/index.js";
import { parseStoredSchedule, type ScheduleStore, type StoredSchedule } from "./ScheduleStore.js";

export interface FileScheduleStoreOptions {
  readonly filePath: string;
}

export class FileScheduleStore implements ScheduleStore {
  private readonly filePath: string;
  private readonly schedules = new Map<string, StoredSchedule>();

  constructor(options: FileScheduleStoreOptions) {
    this.filePath = options.filePath;
    mkdirSync(dirname(this.filePath), { recursive: true });
    for (const schedule of loadSchedules(this.filePath)) {
      this.schedules.set(schedule.id, schedule);
    }
  }

  save(schedule: StoredSchedule): void {
    this.schedules.set(schedule.id, { ...schedule });
    this.write();
  }

  get(scheduleId: string): StoredSchedule | null {
    return this.schedules.get(scheduleId) ?? null;
  }

  list(): StoredSchedule[] {
    return [...this.schedules.values()];
  }

  delete(scheduleId: string): void {
    if (this.schedules.delete(scheduleId)) {
      this.write();
    }
  }

  private write(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify({ version: 1, schedules: [...this.schedules.values()] }, null, 2),
      "utf8"
    );
  }
}

function loadSchedules(filePath: string): StoredSchedule[] {
  if (!existsSync(filePath)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (raw.trim().length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw malformedFile(filePath, 'expected an object with a "schedules" array');
  }
  const schedules = (parsed as { schedules?: unknown[] }).schedules;
  if (!Array.isArray(schedules)) {
    throw malformedFile(filePath, 'expected an object with a "schedules" array');
  }
  try {
    return schedules.map(parseStoredSchedule);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
}

function malformedFile(filePath: string, detail: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed schedule store file "${filePath}": ${detail}`,
    details: { filePath, detail },
  });
}