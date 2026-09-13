import { getDataService, DataService } from '../../../data/DataService';
import { getStores, Stores } from '../../../data/stores';
import { getTaskService } from '../../taskService';
import { emitEvent } from '../events';
import { AutonomyLevel, Run, ScheduleRecord, Task } from '../../../data/types';
import { CronExpression, CronParseError, matchesCron, parseCron } from './cronParser';

export const MAX_CRON_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_CRON_LOOKBACK_STEPS = 24 * 60;
const MINUTE_MS = 60 * 1000;

export type SchedulerSkipReason =
  | 'disabled'
  | 'autonomy-level-0'
  | 'autonomy-level-1-dry-run'
  | 'invalid-cron'
  | 'invalid-interval'
  | 'no-match'
  | 'interval-not-elapsed'
  | 'duplicate-occurrence';

export type ScheduleFireMode = 'dry-run' | 'execute';

export interface ScheduleFiredResult {
  scheduleId: string;
  name: string;
  occurrenceKey: string;
  mode: ScheduleFireMode;
  autonomyLevel: AutonomyLevel;
  taskId?: string;
  taskCode?: string;
  runId?: string;
}

export interface ScheduleSkippedResult {
  scheduleId: string;
  reason: SchedulerSkipReason;
}

export interface SchedulerPassResult {
  evaluatedAt: string;
  fired: ScheduleFiredResult[];
  skipped: ScheduleSkippedResult[];
}

export interface SchedulerPassOptions {
  dataService?: DataService;
  stores?: Stores;
  now?: Date;
}

interface ScheduleEvaluation {
  fire: boolean;
  reason?: SchedulerSkipReason;
  occurrence?: Date;
  schedule?: ScheduleRecord;
}

function truncateToMinute(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    0,
    0
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function occurrenceKeyForSchedule(scheduleId: string, occurrence: Date): string {
  const d = truncateToMinute(occurrence);
  return `${scheduleId}:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function evaluateCronSchedule(
  schedule: ScheduleRecord,
  expression: CronExpression,
  now: Date
): { fire: boolean; occurrence?: Date } {
  const currentMinute = truncateToMinute(now);

  // A schedule that has never run evaluates the current minute only; it does
  // not back-fill arbitrary past occurrences.
  if (!schedule.lastRunAt) {
    if (matchesCron(expression, currentMinute)) {
      return { fire: true, occurrence: currentMinute };
    }
    return { fire: false };
  }

  // Otherwise catch up to the most recent matching minute since lastRunAt
  // (bounded by the lookback window) so downtime is not silently missed.
  const floorMs = Math.max(
    new Date(schedule.lastRunAt).getTime(),
    now.getTime() - MAX_CRON_LOOKBACK_MS
  );

  let cursor = currentMinute.getTime();
  let steps = 0;
  while (cursor > floorMs && steps <= MAX_CRON_LOOKBACK_STEPS) {
    const candidate = new Date(cursor);
    if (matchesCron(expression, candidate)) {
      return { fire: true, occurrence: candidate };
    }
    cursor -= MINUTE_MS;
    steps += 1;
  }
  return { fire: false };
}

export function evaluateIntervalSchedule(
  schedule: ScheduleRecord,
  now: Date
): { fire: boolean; occurrence?: Date } {
  const intervalMs = schedule.intervalMs || 0;
  if (intervalMs <= 0) { return { fire: false }; }
  if (!schedule.lastRunAt) { return { fire: true, occurrence: now }; }
  const elapsed = now.getTime() - new Date(schedule.lastRunAt).getTime();
  if (elapsed >= intervalMs) { return { fire: true, occurrence: now }; }
  return { fire: false };
}

export function evaluateSchedule(schedule: ScheduleRecord, now: Date): ScheduleEvaluation {
  if (!schedule.enabled) { return { fire: false, reason: 'disabled', schedule }; }
  if (schedule.autonomyLevel === 0) { return { fire: false, reason: 'autonomy-level-0', schedule }; }
  if (schedule.autonomyLevel === 1) {
    return { fire: true, reason: 'autonomy-level-1-dry-run', occurrence: now, schedule };
  }

  let result: { fire: boolean; occurrence?: Date };
  if (schedule.kind === 'cron') {
    if (!schedule.cron) { return { fire: false, reason: 'invalid-cron', schedule }; }
    let expression: CronExpression;
    try {
      expression = parseCron(schedule.cron);
    } catch (e) {
      if (e instanceof CronParseError) {
        return { fire: false, reason: 'invalid-cron', schedule };
      }
      throw e;
    }
    result = evaluateCronSchedule(schedule, expression, now);
    if (!result.fire) { return { fire: false, reason: 'no-match', schedule }; }
  } else if (schedule.kind === 'interval') {
    if (!schedule.intervalMs || schedule.intervalMs <= 0) {
      return { fire: false, reason: 'invalid-interval', schedule };
    }
    result = evaluateIntervalSchedule(schedule, now);
    if (!result.fire) { return { fire: false, reason: 'interval-not-elapsed', schedule }; }
  } else {
    return { fire: false, reason: 'invalid-interval', schedule };
  }

  return { fire: true, occurrence: result.occurrence!, schedule };
}

function createQueuedRun(stores: Stores, taskId: string, now: Date): Run {
  const run: Run = {
    id: `run_sched_${taskId}_${now.getTime()}`,
    taskId,
    status: 'queued',
    attempts: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  stores.runs.add(run);
  emitEvent('run.queued', 'scheduler', { runId: run.id, taskId });
  return run;
}

function buildAndAddTask(dataService: DataService, schedule: ScheduleRecord, now: Date): Task {
  const template = schedule.taskTemplate;
  const task = getTaskService(dataService.getWorkspaceRoot()).createTask({
    title: template.title || template.name,
    type: template.type,
    priority: template.priority,
    backlog: template.backlog,
    epic: template.epicName || null
  });
  dataService.updateTask(task.id, {
    source: 'scheduler',
    workflow: schedule.name,
    createdAt: task.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  });
  return task;
}

function updateScheduleState(
  stores: Stores,
  schedule: ScheduleRecord,
  occurrenceKey: string,
  now: Date,
  executed: boolean
): void {
  const updates: Partial<ScheduleRecord> = {
    lastRunAt: now.toISOString(),
    lastOccurrenceKey: occurrenceKey,
    updatedAt: now.toISOString()
  };
  if (executed) {
    updates.runCount = (schedule.runCount || 0) + 1;
  }
  stores.schedules.update(schedule.id, updates);
}

export function runSchedulerPass(options: SchedulerPassOptions = {}): SchedulerPassResult {
  const now = options.now || new Date();
  const dataService = options.dataService || getDataService();
  const stores = options.stores || getStores(dataService.getWorkspaceRoot());

  const schedules = stores.schedules
    .loadAll()
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const fired: ScheduleFiredResult[] = [];
  const skipped: ScheduleSkippedResult[] = [];

  for (const schedule of schedules) {
    const result = evaluateSchedule(schedule, now);

    if (schedule.autonomyLevel === 1) {
      // Dry-run observe mode (conservative default): record occurrences
      // without creating tasks or runs.
      if (!schedule.enabled) {
        skipped.push({ scheduleId: schedule.id, reason: 'disabled' });
        continue;
      }
      const occurrenceKey = occurrenceKeyForSchedule(schedule.id, now);
      if (occurrenceKey === schedule.lastOccurrenceKey) {
        skipped.push({ scheduleId: schedule.id, reason: 'duplicate-occurrence' });
        continue;
      }
      updateScheduleState(stores, schedule, occurrenceKey, now, false);
      fired.push({
        scheduleId: schedule.id,
        name: schedule.name,
        occurrenceKey,
        mode: 'dry-run',
        autonomyLevel: 1
      });
      emitEvent('schedule.observed', 'scheduler', { scheduleId: schedule.id, occurrenceKey });
      continue;
    }

    if (!result.fire) {
      skipped.push({ scheduleId: schedule.id, reason: result.reason || 'no-match' });
      continue;
    }

    const occurrenceKey = occurrenceKeyForSchedule(schedule.id, result.occurrence!);
    if (occurrenceKey === schedule.lastOccurrenceKey) {
      skipped.push({ scheduleId: schedule.id, reason: 'duplicate-occurrence' });
      continue;
    }

    const task = buildAndAddTask(dataService, schedule, now);
    const run = createQueuedRun(stores, task.id, now);
    updateScheduleState(stores, schedule, occurrenceKey, now, true);

    fired.push({
      scheduleId: schedule.id,
      name: schedule.name,
      occurrenceKey,
      mode: 'execute',
      autonomyLevel: schedule.autonomyLevel,
      taskId: task.id,
      taskCode: task.code,
      runId: run.id
    });
    emitEvent('schedule.fired', 'scheduler', {
      scheduleId: schedule.id,
      occurrenceKey,
      taskId: task.id,
      runId: run.id
    });
  }

  return { evaluatedAt: now.toISOString(), fired, skipped };
}