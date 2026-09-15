import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { createPlan, OrchestrationUnit } from '../../src/services/workforce/orchestrator';
import { runOrganizerPass } from '../../src/services/workforce/plan/organizer';
import {
  installDispatcher,
  dispatchPlanEvent,
  enqueuePlan,
  requestPlanCancellation,
  requestPlanReassignment,
  requestPlanRequeue
} from '../../src/services/workforce/plan/dispatcher';
import { startRun } from '../../src/services/workforce/queueService';
import * as eventRulesService from '../../src/services/workforce/eventRulesService';
import { Employee, EventRecord, Plan, WorkflowDefinition } from '../../src/data/types';

function seedAgent(
  ws: TestWorkspace,
  name: string,
  skills: Array<{ name: string; level?: 1 | 2 | 3 }>
): Employee {
  const employee = makeEmployee({
    role: 'agent',
    name,
    status: 'idle',
    skills,
    capabilities: skills.map(s => s.name)
  });
  getStores(ws.root).people.add(employee);
  return employee;
}

function plan(ws: TestWorkspace, unit: OrchestrationUnit): Plan {
  return createPlan('IN-000001', unit, { workspaceRoot: ws.root });
}

function reload(ws: TestWorkspace, id: string): Plan {
  const stored = getStores(ws.root).plans.getById(id);
  assert.ok(stored, `plan ${id} should exist`);
  return stored as Plan;
}

function events(ws: TestWorkspace, type: string): EventRecord[] {
  return getStores(ws.root).events.loadAll().filter(e => e.type === type);
}

function decisionEvent(type: string, planId: string, extra: Record<string, unknown> = {}): EventRecord {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    source: 'organizer',
    payload: { planId, ...extra },
    timestamp: new Date().toISOString()
  };
}

// A plan held in the registry as organized/ready/immediate/assigned to the agent —
// the exact state the Organizer writes before emitting plan.execution.requested.
function readyPlan(ws: TestWorkspace, agent: Employee): Plan {
  const stores = getStores(ws.root);
  const created = plan(ws, {
    title: 'Public API method',
    objective: 'Ship a public API method',
    implementation: 'Design and implement the method.'
  });
  stores.plans.update(created.id, {
    organization: { ...created.organization, status: 'organized', version: 1 },
    scheduling: { ...created.scheduling, status: 'ready', mode: 'immediate' },
    execution: { ...created.execution, status: 'assigned', assignedAgent: agent.id }
  });
  return reload(ws, created.id);
}

function makeWorkflow(id: string, title: string): WorkflowDefinition {
  const now = new Date().toISOString();
  const wf: WorkflowDefinition = {
    id,
    name: `Workflow ${id}`,
    version: '1.0.0',
    enabled: true,
    steps: [{ id: 's1', type: 'task', title, taskType: 'chore', priority: 'low', backlog: 'features' }],
    createdAt: now,
    updatedAt: now
  };
  getStores().workflows.add(wf);
  return wf;
}

describe('v1.0.0 Slice E — Dispatcher', () => {
  let ws: TestWorkspace;
  let unsubscribeDispatcher: () => void;

  before(() => {
    unsubscribeDispatcher = installDispatcher();
  });

  after(() => {
    unsubscribeDispatcher();
  });

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('boundary: Organizer never imports queueService; Dispatcher never imports Organizer/workers', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const organizerSrc = fs.readFileSync(
      path.join(root, 'src', 'services', 'workforce', 'plan', 'organizer.ts'),
      'utf8'
    );
    assert.ok(!organizerSrc.includes("from '../queueService'"), 'organizer must not import queueService');
    const dispatcherSrc = fs.readFileSync(
      path.join(root, 'src', 'services', 'workforce', 'plan', 'dispatcher.ts'),
      'utf8'
    );
    assert.ok(!dispatcherSrc.includes('../organizer'), 'dispatcher must not import organizer');
    assert.ok(!dispatcherSrc.includes('../worker'), 'dispatcher must not import worker');
  });

  it('enqueues an organized/ready plan as one Run with planId and idempotence on re-emission', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);

    const outcome = dispatchPlanEvent(decisionEvent('plan.execution.requested', staged.id, { agentId: ada.id }));
    assert.strictEqual(outcome.action, 'enqueued');
    assert.strictEqual(outcome.runId, reload(ws, staged.id).execution.runId);

    const runs = getStores(ws.root).runs.findByPlanId(staged.id);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'queued');
    assert.strictEqual(runs[0].planId, staged.id);
    assert.strictEqual(runs[0].agentId, ada.id);

    // Same decision again — no duplicate Run.
    const again = dispatchPlanEvent(decisionEvent('plan.execution.requested', staged.id, { agentId: ada.id }));
    assert.strictEqual(again.action, 'noop');
    assert.match(again.reason as string, /run-exists/);
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id).length, 1);
  });

  it('direct enqueuePlan is guarded: not organized/ready or non-immediate means nothing is queued', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];

const pending = plan(ws, {
      title: 'Pending',
      objective: 'Ship a pending thing',
      implementation: 'Later.'
    });
    const pendingSkip = enqueuePlan(pending.id);
    assert.strictEqual(pendingSkip.action, 'noop');
    assert.match(pendingSkip.reason as string, /organization=pending/);
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(pending.id).length, 0);
    assert.strictEqual(dispatchPlanEvent(decisionEvent('plan.execution.requested', pending.id)).action, 'noop');

    const unauthorized = plan(ws, {
      title: 'Unauthorized',
      objective: 'Ship an unassigned thing',
      implementation: 'No agent.'
    });
    getStores(ws.root).plans.update(unauthorized.id, {
      organization: { ...unauthorized.organization, status: 'organized', version: 1 },
      scheduling: { ...unauthorized.scheduling, status: 'ready', mode: 'immediate' },
      execution: { ...unauthorized.execution, status: 'unassigned' }
    });
    const skipped = enqueuePlan(unauthorized.id);
    assert.strictEqual(skipped.action, 'noop');
    assert.match(skipped.reason as string, /no-assigned-agent/);

    const scheduled = plan(ws, {
      title: 'Scheduled',
      objective: 'Run a nightly job',
      implementation: 'batch job'
    });
    getStores(ws.root).plans.update(scheduled.id, {
      organization: { ...scheduled.organization, status: 'organized', version: 1 },
      scheduling: { ...scheduled.scheduling, status: 'ready', mode: 'scheduled' },
      execution: { ...scheduled.execution, status: 'assigned', assignedAgent: ada.id }
    });
    const modeSkipped = enqueuePlan(scheduled.id);
    assert.strictEqual(modeSkipped.action, 'noop');
    assert.match(modeSkipped.reason as string, /mode=scheduled/);
    assert.strictEqual(getStores(ws.root).runs.loadAll().length, 0);
  });

  it('integration: organizer decision → dispatcher → queue Run (single plan.execution.requested)', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const created = plan(ws, {
      title: 'Public API method',
      objective: 'Ship a public API method',
      implementation: 'Design and implement the method.'
    });

    const pass = runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(pass.changed, 1);
    assert.strictEqual(events(ws, 'plan.execution.requested').length, 1);

    const organized = reload(ws, created.id);
    assert.strictEqual(organized.organization.status, 'organized');
    assert.strictEqual(organized.scheduling.status, 'ready');
    assert.strictEqual(organized.scheduling.mode, 'immediate');
    assert.strictEqual(organized.execution.status, 'assigned');
    assert.strictEqual(organized.execution.assignedAgent, ada.id);

    const runs = getStores(ws.root).runs.findByPlanId(created.id);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'queued');
    assert.strictEqual(runs[0].agentId, ada.id);
    assert.strictEqual(runs[0].planId, created.id);
    assert.strictEqual(organized.execution.runId, runs[0].id);

    // A converging pass changes nothing and cannot double-enqueue.
    const second = runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(second.changed, 0);
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(created.id).length, 1);
  });

  it('delayed decision never enqueues and pulls a queued Run back out', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);
    assert.strictEqual(enqueuePlan(staged.id).action, 'enqueued');

    const outcome = dispatchPlanEvent(decisionEvent('plan.execution.delayed', staged.id));
    assert.strictEqual(outcome.action, 'removed');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.status, 'cancelled');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id).length, 1);

    const none = dispatchPlanEvent(decisionEvent('plan.execution.delayed', staged.id));
    assert.strictEqual(none.action, 'noop');
    assert.match(none.reason as string, /nothing-queued/);
  });

  it('cancelled decision removes the queued Run; the Dispatcher never retro-fails scheduling', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);
    assert.strictEqual(enqueuePlan(staged.id).action, 'enqueued');

    dispatchPlanEvent(decisionEvent('plan.execution.cancelled', staged.id));

    const after = reload(ws, staged.id);
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.status, 'cancelled');
    assert.strictEqual(after.execution.status, 'unassigned');
    assert.strictEqual(after.scheduling.status, 'ready', 'queue translation does not decide scheduling');
  });

  it('requestPlanCancellation records the sticky decision and removes pending work', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);
    assert.strictEqual(enqueuePlan(staged.id).action, 'enqueued');

    requestPlanCancellation(staged.id);

    const after = reload(ws, staged.id);
    assert.strictEqual(after.scheduling.status, 'cancelled');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.status, 'cancelled');
    assert.strictEqual(events(ws, 'plan.execution.cancelled').length, 1);
  });

  it('reassigned decision updates the queued Run agent and the registry (by id and by name)', () => {
    const [ada, bo] = [
      seedAgent(ws, 'Ada', [
        { name: 'typescript', level: 3 },
        { name: 'vscode-extension', level: 3 },
        { name: 'apis', level: 3 }
      ]),
      seedAgent(ws, 'Bo', [
        { name: 'typescript', level: 3 },
        { name: 'vscode-extension', level: 3 },
        { name: 'apis', level: 3 }
      ])
    ];
    const staged = readyPlan(ws, ada);
    assert.strictEqual(enqueuePlan(staged.id).action, 'enqueued');

    const outcome = dispatchPlanEvent(decisionEvent('plan.execution.reassigned', staged.id, { agentId: bo.id }));
    assert.strictEqual(outcome.action, 'run-updated');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.agentId, bo.id);
    assert.strictEqual(reload(ws, staged.id).execution.assignedAgent, bo.id);

    requestPlanReassignment(staged.id, 'Ada');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.agentId, ada.id);
    assert.strictEqual(reload(ws, staged.id).execution.assignedAgent, ada.id);
  });

  it('reassigned decision enqueues when no run exists yet and the plan is runnable', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);

    const outcome = dispatchPlanEvent(decisionEvent('plan.execution.reassigned', staged.id, { agentId: ada.id }));
    assert.strictEqual(outcome.action, 'enqueued');
    assert.strictEqual(getStores(ws.root).runs.findByPlanId(staged.id)[0]?.agentId, ada.id);
  });

  it('requeued decision reschedules the running Run and is a no-op once queued', () => {
    const [ada] = [seedAgent(ws, 'Ada', [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ])];
    const staged = readyPlan(ws, ada);
    const enqueued = enqueuePlan(staged.id);
    assert.strictEqual(enqueued.action, 'enqueued');
    startRun(enqueued.runId!);
    assert.strictEqual(getStores(ws.root).runs.getById(enqueued.runId!)?.status, 'running');

    requestPlanRequeue(staged.id, { classification: 'exit-nonzero' });

    const run = getStores(ws.root).runs.getById(enqueued.runId!)!;
    assert.strictEqual(run.status, 'queued');
    assert.strictEqual(run.attempts, 2);
    assert.ok(events(ws, 'run.retried').length === 1);
    assert.strictEqual(events(ws, 'plan.execution.requeued').length, 1);

    const again = dispatchPlanEvent(decisionEvent('plan.execution.requeued', staged.id));
    assert.strictEqual(again.action, 'noop');
    assert.match(again.reason as string, /no-running-run/);
    assert.strictEqual(getStores(ws.root).runs.getById(enqueued.runId!)?.attempts, 2);
  });

  it('event rule: organizer.trigger runs a workflow (plan + queued run) once, no re-entrancy', async () => {
    const wf = makeWorkflow('wf-slice-e', 'Slice E Triage');
    const rule = eventRulesService.createEventRule({
      name: 'Organizer trigger → triage',
      matcher: { eventType: 'organizer.trigger' },
      workflowId: wf.id
    });

    const triggered = decisionEvent('organizer.trigger', 'unused', { at: new Date().toISOString() });
    const results = await eventRulesService.processEventRules(triggered);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]?.triggered, true);
    assert.strictEqual(results[0]?.status, 'completed');
    assert.strictEqual(results[0]?.createdPlanIds?.length, 1);
    assert.strictEqual(getStores(ws.root).eventRules.getById(rule.id)?.runCount, 1);
    assert.strictEqual(getStores(ws.root).plans.count(), 1);
    assert.strictEqual(getStores(ws.root).runs.loadAll().length, 1, 'no dispatcher duplicate work');

    const again = await eventRulesService.processEventRules(triggered);
    assert.strictEqual(again[0]?.skipReason, 'already-triggered');
    assert.strictEqual(getStores(ws.root).eventRules.getById(rule.id)?.runCount, 1);
    assert.strictEqual(getStores(ws.root).runs.loadAll().length, 1);
    assert.strictEqual(getStores(ws.root).plans.count(), 1);
  });
});