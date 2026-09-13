import { strict as assert } from 'node:assert';
import { makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { getDataService } from '../../src/data/DataService';
import { ScheduleRecord } from '../../src/data/types';
import { CronParseError, matchesCron, parseCron } from '../../src/services/workforce/scheduler/cronParser';
import {
  occurrenceKeyForSchedule,
  runSchedulerPass,
  evaluateCronSchedule,
  evaluateIntervalSchedule
} from '../../src/services/workforce/scheduler/scheduler';
import { setApprovalGate } from '../../src/services/workforce/gates';
import { startRun } from '../../src/services/workforce/queueService';

describe('C6 cron parser', () => {
  const at = (minute: number, hour: number, dom = 15, month = 0, dow = 4): Date =>
    new Date(2026, month, dom, hour, minute, 0, 0);

  it('parses an exact value cron and matches only that minute', () => {
    const expr = parseCron('30 9 * * *');
    assert.ok(matchesCron(expr, at(30, 9)));
    assert.ok(!matchesCron(expr, at(31, 9)));
    assert.ok(!matchesCron(expr, at(30, 8)));
  });

  it('wildcard field matches every value', () => {
    const expr = parseCron('* * * * *');
    assert.ok(matchesCron(expr, at(0, 0)));
    assert.ok(matchesCron(expr, at(59, 23)));
    assert.ok(matchesCron(expr, at(15, 12)));
  });

  it('list values match any listed value', () => {
    const expr = parseCron('15,45 * * * *');
    assert.ok(matchesCron(expr, at(15, 9)));
    assert.ok(matchesCron(expr, at(45, 9)));
    assert.ok(!matchesCron(expr, at(30, 9)));
  });

  it('range values match within the range', () => {
    const expr = parseCron('0-30 * * * *');
    assert.ok(matchesCron(expr, at(15, 9)));
    assert.ok(!matchesCron(expr, at(45, 9)));
  });

  it('wildcard step matches every nth value', () => {
    const expr = parseCron('*/15 * * * *');
    for (const m of [0, 15, 30, 45]) {
      assert.ok(matchesCron(expr, at(m, 9)), `minute ${m} should match */15`);
    }
    assert.ok(!matchesCron(expr, at(8, 9)));
  });

  it('range step matches stepped values within the range', () => {
    const expr = parseCron('0-30/10 * * * *');
    for (const m of [0, 10, 20, 30]) {
      assert.ok(matchesCron(expr, at(m, 9)), `minute ${m} should match 0-30/10`);
    }
    assert.ok(!matchesCron(expr, at(35, 9)));
  });

  it('day-of-week field restricts to the given weekday (Jan 15 2026 = Thursday = 4)', () => {
    const expr = parseCron('0 9 * * 4');
    assert.ok(matchesCron(expr, at(0, 9)));
    // same minute on a Friday
    assert.ok(!matchesCron(expr, new Date(2026, 0, 16, 9, 0, 0)));
  });

  it('day-of-month and month fields restrict correctly', () => {
    const expr = parseCron('0 9 15 1 *');
    assert.ok(matchesCron(expr, at(0, 9)));
    assert.ok(!matchesCron(expr, new Date(2026, 1, 15, 9, 0, 0)));
  });

  it('rejects a 6-field expression (seconds are not supported)', () => {
    assert.throws(() => parseCron('*/30 * * * * *'), CronParseError);
  });

  it('rejects out-of-range values', () => {
    assert.throws(() => parseCron('60 * * * *'), CronParseError);
    assert.throws(() => parseCron('* 24 * * *'), CronParseError);
    assert.throws(() => parseCron('* * 0 * *'), CronParseError);
    assert.throws(() => parseCron('* * * 13 *'), CronParseError);
    assert.throws(() => parseCron('* * * * 7'), CronParseError);
  });

  it('rejects unsupported L, W, #, and named month/weekday syntax', () => {
    assert.throws(() => parseCron('0 9 L * *'), CronParseError);
    assert.throws(() => parseCron('0 9 * * 5#2'), CronParseError);
    assert.throws(() => parseCron('0 9 JAN * MON'), CronParseError);
  });

  it('rejects an invalid range (end before start)', () => {
    assert.throws(() => parseCron('30-10 * * * *'), CronParseError);
  });
});

describe('C6 deterministic scheduler', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  function makeSchedule(id: string, overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
    const now = new Date().toISOString();
    const schedule: ScheduleRecord = {
      id,
      name: `Schedule ${id}`,
      enabled: true,
      kind: 'cron',
      autonomyLevel: 2,
      taskTemplate: {
        name: `Task ${id}`,
        title: `Scheduled task ${id}`,
        type: 'chore',
        priority: 'low',
        backlog: 'features'
      },
      cron: '30 9 * * *',
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    getStores(ws.root).schedules.add(schedule);
    return schedule;
  }

  const at = (minute: number, hour: number): Date => new Date(2026, 0, 15, hour, minute, 0, 0);

  it('creates a task and a queued run for a matching cron schedule', () => {
    makeSchedule('cron-exact', { cron: '30 9 * * *', taskTemplate: { name: 'Nightly', title: 'Nightly check', type: 'chore', priority: 'low', backlog: 'features' } });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });

    assert.strictEqual(result.fired.length, 1);
    const fired = result.fired[0];
    assert.strictEqual(fired.mode, 'execute');
    assert.strictEqual(fired.scheduleId, 'cron-exact');
    assert.ok(fired.taskId, 'task should be created');
    assert.match(fired.taskCode || '', /^SPD-\d+$/);
    assert.ok(fired.runId);

    const task = getDataService(ws.root).getTask(fired.taskId!);
    assert.ok(task, 'created task should be readable');
    assert.strictEqual(task!.title, 'Nightly check');
    assert.strictEqual(task!.type, 'chore');
    assert.strictEqual(task!.priority, 'low');
    assert.strictEqual(task!.source, 'scheduler');
    assert.strictEqual(task!.workflow, 'Schedule cron-exact');
    assert.strictEqual(task!.code, `SPD-${task!.number}`);

    const run = getStores(ws.root).runs.getById(fired.runId!);
    assert.strictEqual(run!.status, 'queued');
    assert.strictEqual(run!.attempts, 1);

    const stored = getStores(ws.root).schedules.getById('cron-exact');
    assert.strictEqual(stored!.runCount, 1);
    assert.strictEqual(stored!.lastOccurrenceKey, occurrenceKeyForSchedule('cron-exact', at(30, 9)));
    assert.ok(stored!.lastRunAt);

    const firedEvent = getStores(ws.root).events.findByType('schedule.fired');
    assert.strictEqual(firedEvent.length, 1);
  });

  it('is idempotent: the same occurrence never creates a duplicate', () => {
    makeSchedule('cron-idem', { cron: '30 9 * * *' });

    const first = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });
    assert.strictEqual(first.fired.length, 1);
    const taskCountAfterFirst = getDataService(ws.root).loadTasks().length;

    const second = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });
    assert.strictEqual(second.fired.length, 0);
    assert.ok(
      second.skipped.some(s => s.scheduleId === 'cron-idem'),
      'the already-fired occurrence must be skipped'
    );
    assert.strictEqual(getDataService(ws.root).loadTasks().length, taskCountAfterFirst);
  });

  it('rejects an already-recorded occurrence via lastOccurrenceKey', () => {
    const now = at(30, 9);
    const key = occurrenceKeyForSchedule('guard', now);
    makeSchedule('guard', {
      cron: '* * * * *',
      lastRunAt: new Date(now.getTime() - 30_000).toISOString(),
      lastOccurrenceKey: key
    });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'guard', reason: 'duplicate-occurrence' }]);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
  });

  it('skips a cron schedule that does not match, without creating anything', () => {
    makeSchedule('cron-nomatch', { cron: '30 9 * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 10) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-nomatch', reason: 'no-match' }]);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);
  });

  it('an invalid cron expression is skipped without crashing the pass', () => {
    makeSchedule('cron-invalid', { cron: '30 9 * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-invalid', reason: 'invalid-cron' }]);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
  });

  it('a disabled schedule is never evaluated', () => {
    makeSchedule('cron-disabled', { enabled: false, cron: '30 9 * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });

    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-disabled', reason: 'disabled' }]);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
  });

  it('handles missed cron occurrences by catching up to the most recent matching minute', () => {
    // last run yesterday at 09:30; scheduler was down; today 09:31 should still fire for 09:30
    const yesterday = new Date(2026, 0, 14, 9, 30, 0).toISOString();
    makeSchedule('cron-missed', { cron: '30 9 * * *', lastRunAt: yesterday });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 15, 9, 31, 0) });

    assert.strictEqual(result.fired.length, 1);
    assert.strictEqual(result.fired[0].mode, 'execute');
    const stored = getStores(ws.root).schedules.getById('cron-missed');
    assert.strictEqual(stored!.lastOccurrenceKey, occurrenceKeyForSchedule('cron-missed', at(30, 9)));
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 1);
  });

  it('does not back-fill occurrences older than the 24h lookback window', () => {
    const lastMonth = new Date(2025, 11, 1, 9, 0, 0).toISOString();
    makeSchedule('cron-lookback', { cron: '0 9 1 * *', lastRunAt: lastMonth });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 15, 10, 0, 0) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-lookback', reason: 'no-match' }]);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
  });

  it('interval schedules fire immediately on first evaluation and catch up missed windows', () => {
    makeSchedule('int-first', { kind: 'interval', intervalMs: 60_000 });

    const first = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 9) });
    assert.strictEqual(first.fired.length, 1);
    assert.strictEqual(first.fired[0].mode, 'execute');
    assert.strictEqual(getStores(ws.root).schedules.getById('int-first')!.runCount, 1);

    const within = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 15, 9, 0, 30) });
    assert.strictEqual(within.fired.length, 0);
    assert.deepStrictEqual(within.skipped, [{ scheduleId: 'int-first', reason: 'interval-not-elapsed' }]);

    const elapsed = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 15, 9, 2, 0) });
    assert.strictEqual(elapsed.fired.length, 1);
    assert.strictEqual(getStores(ws.root).schedules.getById('int-first')!.runCount, 2);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 2);
  });

  it('tracks lastRunAt and updates runCount per successful execution', () => {
    makeSchedule('int-lastrun', { kind: 'interval', intervalMs: 5 * 60_000 });

    runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 9) });
    const afterFirst = getStores(ws.root).schedules.getById('int-lastrun')!;
    assert.ok(afterFirst.lastRunAt);
    assert.strictEqual(afterFirst.runCount, 1);

    runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 15, 9, 5, 0) });
    const afterSecond = getStores(ws.root).schedules.getById('int-lastrun')!;
    assert.strictEqual(afterSecond.runCount, 2);
    assert.ok(Number(new Date(afterSecond.lastRunAt!)) > Number(new Date(afterFirst.lastRunAt!)));
  });

  it('evaluateIntervalSchedule uses lastRunAt elapsed semantics', () => {
    const now = at(0, 9);
    const schedule = makeSchedule('int-eval', { kind: 'interval', intervalMs: 60_000, lastRunAt: new Date(2026, 0, 15, 8, 59, 30).toISOString() });

    const notYet = evaluateIntervalSchedule(schedule, now);
    assert.strictEqual(notYet.fire, false);

    const missed = evaluateIntervalSchedule(schedule, new Date(2026, 0, 15, 9, 1, 0));
    assert.strictEqual(missed.fire, true);
    assert.ok(missed.occurrence);
  });

  it('respects autonomy level 0 (disabled entirely) and level 1 (dry-run observe)', () => {
    makeSchedule('aut-0', { autonomyLevel: 0, cron: '* * * * *' });
    makeSchedule('aut-1', { autonomyLevel: 1, cron: '* * * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 9) });

    const skippedReasons = result.skipped.map(s => s.reason);
    assert.ok(skippedReasons.includes('autonomy-level-0'));
    assert.deepStrictEqual(
      result.fired.find(f => f.scheduleId === 'aut-1'),
      {
        scheduleId: 'aut-1',
        name: 'Schedule aut-1',
        occurrenceKey: occurrenceKeyForSchedule('aut-1', at(0, 9)),
        mode: 'dry-run',
        autonomyLevel: 1
      }
    );

    assert.strictEqual(getDataService(ws.root).loadTasks().length, 0);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);
    const aut1 = getStores(ws.root).schedules.getById('aut-1')!;
    assert.ok(aut1.lastRunAt);
    assert.strictEqual(aut1.runCount, 0);
  });

  it('executes at autonomy levels 2 and 3', () => {
    makeSchedule('aut-2', { autonomyLevel: 2, cron: '* * * * *' });
    makeSchedule('aut-3', { autonomyLevel: 3, cron: '* * * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 9) });

    assert.strictEqual(result.fired.filter(f => f.mode === 'execute').length, 2);
    assert.deepStrictEqual(result.fired.map(f => f.scheduleId).sort(), ['aut-2', 'aut-3']);
    assert.strictEqual(getDataService(ws.root).loadTasks().length, 2);
    assert.strictEqual(getStores(ws.root).runs.count(), 2);
  });

  it('evaluates schedules in deterministic (id-sorted) order', () => {
    makeSchedule('sched-c', { cron: '* * * * *' });
    makeSchedule('sched-a', { cron: '* * * * *' });
    makeSchedule('sched-b', { cron: '* * * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(0, 9) });

    assert.deepStrictEqual(
      result.fired.map(f => f.scheduleId),
      ['sched-a', 'sched-b', 'sched-c']
    );
  });

  it('never directly executes a run: runs stay queued and only scheduler/queue events are emitted', () => {
    makeSchedule('never-exec', { cron: '30 9 * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });

    const run = getStores(ws.root).runs.getById(result.fired[0].runId!)!;
    assert.strictEqual(run.status, 'queued');
    assert.strictEqual(run.startedAt, undefined);
    assert.strictEqual(run.finishedAt, undefined);

    const eventTypes = getStores(ws.root).events.loadAll().map(e => e.type);
    assert.ok(eventTypes.includes('schedule.fired'));
    assert.ok(eventTypes.includes('run.queued'));
    assert.ok(!eventTypes.includes('run.started'), 'scheduler must not start runs');
  });

  it('keeps approval-sensitive work gated: a manual run-execution gate holds scheduler-created runs', () => {
    makeSchedule('approval-gate', { cron: '30 9 * * *' });

    const result = runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: at(30, 9) });
    const runId = result.fired[0].runId!;
    assert.strictEqual(getStores(ws.root).runs.getById(runId)!.status, 'queued');

    setApprovalGate('run-execution', 'manual');
    const started = startRun(runId);
    assert.strictEqual(started, undefined, 'manual gate should block starting the run');

    const pending = getStores(ws.root).approvals.loadAll().filter(a => a.type === 'run-execution' && a.status === 'pending');
    assert.ok(pending.length >= 1, 'a pending run-execution approval should be requested');
    assert.strictEqual(getStores(ws.root).runs.getById(runId)!.status, 'queued');
  });
});