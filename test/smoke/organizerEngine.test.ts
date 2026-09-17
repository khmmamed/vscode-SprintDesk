import { strict as assert } from 'node:assert';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { emitEvent } from '../../src/services/workforce/events';
import {
  installOrganizerEventTriggers,
  startScheduler
} from '../../src/services/workforce/scheduler/organizerEngine';
import { installDispatcher } from '../../src/services/workforce/plan/dispatcher';
import { runOrganizerPass } from '../../src/services/workforce/plan/organizer';
import { buildSchedulerPass } from '../../src/cli/scheduler';
import { createPlan } from '../../src/services/workforce/orchestrator';
import { getQueueSettings, updateQueueSettings } from '../../src/services/workforce/queueService';
import { ScheduleRecord } from '../../src/data/types';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeSchedule(ws: TestWorkspace, id: string, overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  const now = new Date().toISOString();
  const schedule: ScheduleRecord = {
    id,
    name: `Schedule ${id}`,
    enabled: true,
    kind: 'interval',
    autonomyLevel: 2,
    planTemplate: {
      name: `Task ${id}`,
      title: `Scheduled ${id}`,
      category: 'maintenance',
      priority: 'low'
    },
    intervalMs: 1,
    runCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  getStores(ws.root).schedules.add(schedule);
  return schedule;
}

// maintenance category → chore proposal type → DEFAULT_TYPE_SKILLS['chore'] = ['planning']
function seedAgent(ws: TestWorkspace, name: string): void {
  const employee = makeEmployee({
    role: 'agent',
    name,
    status: 'idle',
    skills: [{ name: 'planning', level: 3 }],
    capabilities: ['planning']
  });
  getStores(ws.root).people.add(employee);
}

describe('v1.0.0 Slice F — Organizer engine wiring', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('is inert while queueSettings.enabled is false', async () => {
    assert.strictEqual(getQueueSettings().enabled, false);
    makeSchedule(ws, 'disabled-driver');

    const driver = startScheduler();
    try {
      await delay(120);
      const stored = getStores(ws.root).schedules.getById('disabled-driver')!;
      assert.strictEqual(stored.lastRunAt, undefined, 'no interval driver should run while disabled');
      assert.strictEqual(getStores(ws.root).plans.count(), 0);
    } finally {
      driver.stop();
    }
  });

  it('the interval driver honors pollIntervalMs and repeatedly runs scheduler passes', async () => {
    updateQueueSettings({ enabled: true, pollIntervalMs: 25 });
    makeSchedule(ws, 'ticker');

    const driver = startScheduler();
    try {
      await delay(180);
      const planCount = getStores(ws.root).plans.count();
      assert.ok(planCount >= 3, `expected multiple passes to materialize plans, got ${planCount}`);
      assert.ok(getStores(ws.root).schedules.getById('ticker')!.runCount >= 3);
    } finally {
      driver.stop();
    }
  });

  it('consecutive driver starts are idempotent (previous interval is cleared)', async () => {
    updateQueueSettings({ enabled: true, pollIntervalMs: 20 });
    makeSchedule(ws, 'restart');

    const driverA = startScheduler();
    driverA.stop();
    const driverB = startScheduler();
    try {
      await delay(120);
      assert.ok(
        getStores(ws.root).schedules.getById('restart')!.runCount >= 3,
        'only the latest driver interval should tick'
      );
    } finally {
      driverB.stop();
    }
  });

  it('event path: an agent.idle raises organizer.trigger and dispatches a queued run without any schedule', () => {
    const unsubscribe = installOrganizerEventTriggers();
    const dispose = installDispatcher();
    try {
      seedAgent(ws, 'Gamal');
      const created = createPlan(
        'IN-000001',
        {
          title: 'X',
          objective: 'Ship X',
          implementation: 'Do X',
          classification: { category: 'maintenance', priority: 'low' }
        },
        { workspaceRoot: ws.root }
      );

      emitEvent('agent.idle', 'workforce', { employeeId: 'emp_1', name: 'Gamal', from: 'busy' });

      const organized = getStores(ws.root).plans.getById(created.id)!;
      assert.strictEqual(organized.organization.status, 'organized');
      assert.ok(organized.execution.assignedAgent, 'a qualified agent should be assigned');

      const triggers = getStores(ws.root).events.findByType('organizer.trigger');
      assert.strictEqual(triggers.length, 1);
      assert.strictEqual(triggers[0].payload.cause, 'agent.idle');
      assert.strictEqual(triggers[0].source, 'organizer');

      const runs = getStores(ws.root).runs.loadAll();
      assert.strictEqual(runs.length, 1, 'the triggered pass should dispatch a queued run');
      assert.strictEqual(runs[0].status, 'queued');
    } finally {
      dispose();
      unsubscribe();
    }
  });

  it('execution.completed also raises organizer.trigger without a schedule ever existing', () => {
    const unsubscribe = installOrganizerEventTriggers();
    try {
      emitEvent('execution.completed', 'queue', { runId: 'run_1', planId: 'PLAN-000001' });

      const triggers = getStores(ws.root).events.findByType('organizer.trigger');
      assert.strictEqual(triggers.length, 1);
      assert.strictEqual(triggers[0].payload.cause, 'execution.completed');
      assert.strictEqual(triggers[0].source, 'organizer');
    } finally {
      unsubscribe();
    }
  });

  it('the engine does not react to organizer.trigger (no event cascade)', () => {
    const unsubscribe = installOrganizerEventTriggers();
    try {
      runOrganizerPass({ workspaceRoot: ws.root });

      const events = getStores(ws.root).events.loadAll();
      const triggers = events.filter(e => e.type === 'organizer.trigger');
      assert.strictEqual(triggers.length, 0, 'runOrganizerPass alone never emits organizer.trigger');
    } finally {
      unsubscribe();
    }
  });

  it('CLI: buildSchedulerPass --organize and --once modes run against the workspace', async () => {
    seedAgent(ws, 'Gamal');
    createPlan(
      'IN-000001',
      {
        title: 'Y',
        objective: 'Ship Y',
        implementation: 'Do Y',
        classification: { category: 'maintenance', priority: 'low' }
      },
      { workspaceRoot: ws.root }
    );
    makeSchedule(ws, 'cli-plan', { kind: 'interval', intervalMs: 1 });

    const organize = await buildSchedulerPass(ws.root, ['--organize']);
    assert.strictEqual(organize.action, 'organize');
    assert.strictEqual(organize.organizer?.examined, 1);
    assert.strictEqual(organize.organizer?.changed, 1);

    const once = await buildSchedulerPass(ws.root, ['--once']);
    assert.strictEqual(once.action, 'once');
    assert.ok(once.fired && once.fired.length === 1);
    assert.strictEqual(once.fired![0].scheduleId, 'cli-plan');
    assert.strictEqual(getStores(ws.root).plans.count(), 2);
  });
});