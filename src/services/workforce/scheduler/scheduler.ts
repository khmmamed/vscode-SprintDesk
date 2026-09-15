import { getDataService, DataService } from '../../../data/DataService';
import { getStores, Stores } from '../../../data/stores';
import { emitEvent } from '../events';
import { AutonomyLevel, Plan, PlanPriority, Run, ScheduleRecord } from '../../../data/types';
import { legacyTaskKindToPlanCategory, materializePlan } from '../plan/planService';
import { CronExpression, CronParseError, matchesCron, parseCron } from './cronParser';
import { runClassificationPass, ClassificationPassResult } from '../classification/classificationService';

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
  // v1.0 Slice D — schedules materialize Plans (planId/planCode), not Tasks.
  planId?: string;
  planCode?: string;
  runId?: string;
  classification?: ClassificationPassResult;
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

function createQueuedRun(stores: Stores, planId: string, now: Date): Run {
  const run: Run = {
    id: `run_sched_${planId}_${now.getTime()}`,
    planId,
    status: 'queued',
    attempts: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  stores.runs.add(run);
  emitEvent('run.queued', 'scheduler', { runId: run.id, planId });
  return run;
}

type ScheduleTaskType = 'feature' | 'bug' | 'chore' | 'doc' | 'test';

// Materializes a ScheduleTaskTemplate into a runnable Plan (the queue's execution unit),
// its source stamped `synthetic:schedule:<id>` so provenance stays intact.
function materializeSchedulePlan(stores: Stores, schedule: ScheduleRecord, now: Date): Plan | undefined {
  const template = schedule.taskTemplate;
  if (!template) {return undefined;}
  return materializePlan(
    {
      sourceInputId: `synthetic:schedule:${schedule.id}`,
      title: template.title || template.name,
      description: template.name,
      category: legacyTaskKindToPlanCategory(template.type as ScheduleTaskType),
      priority: template.priority as PlanPriority
    },
    { stores }
  );
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

export async function runSchedulerPass(options: SchedulerPassOptions = {}): Promise<SchedulerPassResult> {
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
      // without creating tasks, runs, or classification passes.
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

    if ((schedule.action ?? 'task') === 'classify') {
      // Fires the existing classification pipeline (deterministic → LLM), which
      // itself honors maxProposalsPerPass, the task-proposal gate, dedup, and cap.
      const classification = await runClassificationPass();
      updateScheduleState(stores, schedule, occurrenceKey, now, true);
      fired.push({
        scheduleId: schedule.id,
        name: schedule.name,
        occurrenceKey,
        mode: 'execute',
        autonomyLevel: schedule.autonomyLevel,
        classification
      });
      emitEvent('classification.pass', 'scheduler', {
        scheduleId: schedule.id,
        occurrenceKey,
        ...classification
      });
      continue;
    }

    const plan = materializeSchedulePlan(stores, schedule, now);
    if (!plan) {
      skipped.push({ scheduleId: schedule.id, reason: 'invalid-interval' });
      continue;
    }
    const run = createQueuedRun(stores, plan.id, now);
    updateScheduleState(stores, schedule, occurrenceKey, now, true);

    fired.push({
      scheduleId: schedule.id,
      name: schedule.name,
      occurrenceKey,
      mode: 'execute',
      autonomyLevel: schedule.autonomyLevel,
      planId: plan.id,
      planCode: plan.id,
      runId: run.id
    });
    emitEvent('schedule.fired', 'scheduler', {
      scheduleId: schedule.id,
      occurrenceKey,
      planId: plan.id,
      runId: run.id
    });
  }

  return { evaluatedAt: now.toISOString(), fired, skipped };
}