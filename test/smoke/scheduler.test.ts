import { strict as assert } from 'node:assert';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { Employee, ScheduleRecord } from '../../src/data/types';
import { CronParseError, matchesCron, parseCron } from '../../src/services/workforce/scheduler/cronParser';
import {
  occurrenceKeyForSchedule,
  runSchedulerPass,
  evaluateCronSchedule,
  evaluateIntervalSchedule
} from '../../src/services/workforce/scheduler/scheduler';
import { planTitleFor } from '../../src/services/workforce/plan/planService';
import { createPlan } from '../../src/services/workforce/orchestrator';
import { installDispatcher } from '../../src/services/workforce/plan/dispatcher';
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
      planTemplate: {
        name: `Task ${id}`,
        title: `Scheduled task ${id}`,
        category: 'maintenance',
        priority: 'low'
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

  // maintenance category → chore proposal type → DEFAULT_TYPE_SKILLS['chore'] = ['planning']
  function seedPlanningAgent(name = 'Pat'): Employee {
    const employee = makeEmployee({
      role: 'agent',
      name,
      status: 'idle',
      skills: [{ name: 'planning', level: 3 }],
      capabilities: ['planning']
    });
    getStores(ws.root).people.add(employee);
    return employee;
  }

  function seedPendingPlan(title: string) {
    return createPlan(
      'IN-000001',
      {
        title,
        objective: `Ship ${title}`,
        implementation: `Implement ${title}`,
        classification: { category: 'maintenance', priority: 'low' }
      },
      { workspaceRoot: ws.root }
    );
  }

  const at = (minute: number, hour: number): Date => new Date(2026, 0, 15, hour, minute, 0, 0);

  it('materializes a pending plan for a matching cron schedule without creating runs', async () => {
    makeSchedule('cron-exact', { cron: '30 9 * * *', planTemplate: { name: 'Nightly', title: 'Nightly check', category: 'maintenance', priority: 'low' } });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });

    assert.strictEqual(result.fired.length, 1);
    const fired = result.fired[0];
    assert.strictEqual(fired.mode, 'execute');
    assert.strictEqual(fired.scheduleId, 'cron-exact');
    assert.ok(fired.planId, 'plan should be created');
    assert.match(fired.planCode || '', /^PLAN-\d{6}$/);

    const plan = getStores(ws.root).plans.getById(fired.planId!);
    assert.ok(plan, 'created plan should be readable');
    assert.strictEqual(planTitleFor(plan!, ws.root), 'Nightly check');
    assert.strictEqual(plan!.classification.original.category, 'maintenance');
    assert.strictEqual(plan!.classification.original.priority, 'low');
    assert.strictEqual(plan!.source.inputId, 'synthetic:schedule:cron-exact');
    assert.strictEqual(plan!.organization.status, 'pending');
    assert.strictEqual(plan!.execution.status, 'unassigned');

    // Boundary: the scheduler never creates runs — only the Organizer/Dispatcher path does.
    assert.strictEqual(getStores(ws.root).runs.count(), 0);

    const stored = getStores(ws.root).schedules.getById('cron-exact');
    assert.strictEqual(stored!.runCount, 1);
    assert.strictEqual(stored!.lastOccurrenceKey, occurrenceKeyForSchedule('cron-exact', at(30, 9)));
    assert.ok(stored!.lastRunAt);

    const firedEvent = getStores(ws.root).events.findByType('schedule.fired');
    assert.strictEqual(firedEvent.length, 1);
  });

  it('is idempotent: the same occurrence never creates a duplicate', async () => {
    makeSchedule('cron-idem', { cron: '30 9 * * *' });

    const first = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });
    assert.strictEqual(first.fired.length, 1);
    const planCountAfterFirst = getStores(ws.root).plans.count();

    const second = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });
    assert.strictEqual(second.fired.length, 0);
    assert.ok(
      second.skipped.some(s => s.scheduleId === 'cron-idem'),
      'the already-fired occurrence must be skipped'
    );
    assert.strictEqual(getStores(ws.root).plans.count(), planCountAfterFirst);
  });

  it('rejects an already-recorded occurrence via lastOccurrenceKey', async () => {
    const now = at(30, 9);
    const key = occurrenceKeyForSchedule('guard', now);
    makeSchedule('guard', {
      cron: '* * * * *',
      lastRunAt: new Date(now.getTime() - 30_000).toISOString(),
      lastOccurrenceKey: key
    });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'guard', reason: 'duplicate-occurrence' }]);
    assert.strictEqual(getStores(ws.root).plans.count(), 0);
  });

  it('skips a cron schedule that does not match, without creating anything', async () => {
    makeSchedule('cron-nomatch', { cron: '30 9 * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 10) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-nomatch', reason: 'no-match' }]);
    assert.strictEqual(getStores(ws.root).plans.count(), 0);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);
  });

  it('an invalid cron expression is skipped without crashing the pass', async () => {
    makeSchedule('cron-invalid', { cron: '30 9 * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-invalid', reason: 'invalid-cron' }]);
    assert.strictEqual(getStores(ws.root).plans.count(), 0);
  });

  it('a disabled schedule is never evaluated', async () => {
    makeSchedule('cron-disabled', { enabled: false, cron: '30 9 * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });

    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-disabled', reason: 'disabled' }]);
    assert.strictEqual(getStores(ws.root).plans.count(), 0);
  });

  it('handles missed cron occurrences by catching up to the most recent matching minute', async () => {
    // last run yesterday at 09:30; scheduler was down; today 09:31 should still fire for 09:30
    const yesterday = new Date(2026, 0, 14, 9, 30, 0).toISOString();
    makeSchedule('cron-missed', { cron: '30 9 * * *', lastRunAt: yesterday });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: new Date(2026, 0, 15, 9, 31, 0) });

    assert.strictEqual(result.fired.length, 1);
    assert.strictEqual(result.fired[0].mode, 'execute');
    const stored = getStores(ws.root).schedules.getById('cron-missed');
    assert.strictEqual(stored!.lastOccurrenceKey, occurrenceKeyForSchedule('cron-missed', at(30, 9)));
    assert.strictEqual(getStores(ws.root).plans.count(), 1);
  });

  it('does not back-fill occurrences older than the 24h lookback window', async () => {
    const lastMonth = new Date(2025, 11, 1, 9, 0, 0).toISOString();
    makeSchedule('cron-lookback', { cron: '0 9 1 * *', lastRunAt: lastMonth });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: new Date(2026, 0, 15, 10, 0, 0) });

    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'cron-lookback', reason: 'no-match' }]);
    assert.strictEqual(getStores(ws.root).plans.count(), 0);
  });

  it('interval schedules fire immediately on first evaluation and catch up missed windows', async () => {
    makeSchedule('int-first', { kind: 'interval', intervalMs: 60_000 });

    const first = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });
    assert.strictEqual(first.fired.length, 1);
    assert.strictEqual(first.fired[0].mode, 'execute');
    assert.strictEqual(getStores(ws.root).schedules.getById('int-first')!.runCount, 1);

    const within = await runSchedulerPass({ stores: getStores(ws.root), now: new Date(2026, 0, 15, 9, 0, 30) });
    assert.strictEqual(within.fired.length, 0);
    assert.deepStrictEqual(within.skipped, [{ scheduleId: 'int-first', reason: 'interval-not-elapsed' }]);

    const elapsed = await runSchedulerPass({ stores: getStores(ws.root), now: new Date(2026, 0, 15, 9, 2, 0) });
    assert.strictEqual(elapsed.fired.length, 1);
    assert.strictEqual(getStores(ws.root).schedules.getById('int-first')!.runCount, 2);
    assert.strictEqual(getStores(ws.root).plans.count(), 2);
  });

  it('tracks lastRunAt and updates runCount per successful execution', async () => {
    makeSchedule('int-lastrun', { kind: 'interval', intervalMs: 5 * 60_000 });

    await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });
    const afterFirst = getStores(ws.root).schedules.getById('int-lastrun')!;
    assert.ok(afterFirst.lastRunAt);
    assert.strictEqual(afterFirst.runCount, 1);

    await runSchedulerPass({ stores: getStores(ws.root), now: new Date(2026, 0, 15, 9, 5, 0) });
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

  it('respects autonomy level 0 (disabled entirely) and level 1 (dry-run observe)', async () => {
    makeSchedule('aut-0', { autonomyLevel: 0, cron: '* * * * *' });
    makeSchedule('aut-1', { autonomyLevel: 1, cron: '* * * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });

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

    assert.strictEqual(getStores(ws.root).plans.count(), 0);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);
    const aut1 = getStores(ws.root).schedules.getById('aut-1')!;
    assert.ok(aut1.lastRunAt);
    assert.strictEqual(aut1.runCount, 0);
  });

  it('materializes plans at autonomy levels 2 and 3 (never runs)', async () => {
    makeSchedule('aut-2', { autonomyLevel: 2, cron: '* * * * *' });
    makeSchedule('aut-3', { autonomyLevel: 3, cron: '* * * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });

    assert.strictEqual(result.fired.filter(f => f.mode === 'execute').length, 2);
    assert.deepStrictEqual(result.fired.map(f => f.scheduleId).sort(), ['aut-2', 'aut-3']);
    assert.strictEqual(getStores(ws.root).plans.count(), 2);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);
  });

  it('evaluates schedules in deterministic (id-sorted) order', async () => {
    makeSchedule('sched-c', { cron: '* * * * *' });
    makeSchedule('sched-a', { cron: '* * * * *' });
    makeSchedule('sched-b', { cron: '* * * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });

    assert.deepStrictEqual(
      result.fired.map(f => f.scheduleId),
      ['sched-a', 'sched-b', 'sched-c']
    );
  });

  it('never directly creates or starts runs: only schedule events are emitted', async () => {
    makeSchedule('never-exec', { cron: '30 9 * * *' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });

    assert.ok(result.fired[0].planId);
    assert.strictEqual(getStores(ws.root).runs.count(), 0);

    const eventTypes = getStores(ws.root).events.loadAll().map(e => e.type);
    assert.ok(eventTypes.includes('schedule.fired'));
    assert.ok(!eventTypes.includes('run.queued'), 'scheduler must not queue runs');
    assert.ok(!eventTypes.includes('run.started'), 'scheduler must not start runs');
  });

  it('organize schedules fire a capped Organizer pass and record the occurrence', async () => {
    seedPlanningAgent('Gamal');
    const p1 = seedPendingPlan('one');
    seedPendingPlan('two');
    seedPendingPlan('three');
    makeSchedule('org-cap', { cron: '30 9 * * *', action: 'organize' });

    const capped = await runSchedulerPass({
      stores: getStores(ws.root),
      now: at(30, 9),
      organizerCap: 1
    });

    assert.strictEqual(capped.fired.length, 1);
    assert.deepStrictEqual(capped.fired[0].organizer, { examined: 1, changed: 1, planIds: [p1.id] });

    const organized = getStores(ws.root).plans
      .loadAll()
      .filter(p => p.organization.status === 'organized')
      .map(p => p.id);
    assert.deepStrictEqual(organized, [p1.id], 'cap 1 must leave the remaining plans pending');

    const stored = getStores(ws.root).schedules.getById('org-cap')!;
    assert.strictEqual(stored.runCount, 1);
    assert.ok(stored.lastRunAt);
  });

  it('an organize pass that changes nothing fires nothing but still records the occurrence', async () => {
    seedPlanningAgent('Gamal');
    makeSchedule('org-nochange', { kind: 'interval', intervalMs: 60_000, action: 'organize' });

    const first = await runSchedulerPass({ stores: getStores(ws.root), now: at(0, 9) });

    assert.strictEqual(first.fired.length, 0);
    assert.strictEqual(getStores(ws.root).events.findByType('schedule.fired').length, 0);
    const stored = getStores(ws.root).schedules.getById('org-nochange')!;
    assert.ok(stored.lastRunAt, 'the occurrence is recorded even when nothing fires');
    assert.strictEqual(stored.runCount, 0, 'a no-change pass is not counted as a fire');
  });

  it('keeps approval-sensitive work gated through the plan → organize → dispatcher pipeline', async () => {
    seedPlanningAgent('Gamal');
    const dispose = installDispatcher();
    try {
      makeSchedule('pipe-a-plan', {
        cron: '30 9 * * *',
        planTemplate: { name: 'Maintenance', title: 'Maintenance sweep', category: 'maintenance', priority: 'low' }
      });
      makeSchedule('pipe-b-organize', { cron: '30 9 * * *', action: 'organize' });

      const result = await runSchedulerPass({ stores: getStores(ws.root), now: at(30, 9) });
      assert.strictEqual(result.fired.length, 2);

      const runs = getStores(ws.root).runs.loadAll();
      assert.strictEqual(runs.length, 1, 'the organizer decision must enqueue exactly one run');
      assert.strictEqual(runs[0].status, 'queued');

      setApprovalGate('run-execution', 'manual');
      const started = startRun(runs[0].id);
      assert.strictEqual(started, undefined, 'manual gate should block starting the run');

      const pending = getStores(ws.root).approvals.loadAll().filter(a => a.type === 'run-execution' && a.status === 'pending');
      assert.ok(pending.length >= 1, 'a pending run-execution approval should be requested');
      assert.strictEqual(getStores(ws.root).runs.getById(runs[0].id)!.status, 'queued');
    } finally {
      dispose();
    }
  });
});