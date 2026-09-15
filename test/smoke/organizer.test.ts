import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { createPlan, OrchestrationUnit } from '../../src/services/workforce/orchestrator';
import { runOrganizerPass, triggerOrganizer, analyzeContent } from '../../src/services/workforce/plan/organizer';
import { planMdPath } from '../../src/services/workforce/plan/planService';
import { Employee, Plan } from '../../src/data/types';

function seedAgents(
  ws: TestWorkspace,
  agents: Array<{ name: string; skills: Array<{ name: string; level?: 1 | 2 | 3 }>; status?: 'idle' | 'busy' }>
): Employee[] {
  const stores = getStores(ws.root);
  const seeded = agents.map(a => {
    const employee = makeEmployee({
      role: 'agent',
      name: a.name,
      status: a.status || 'idle',
      skills: a.skills,
      capabilities: a.skills.map(s => s.name)
    });
    stores.people.add(employee);
    return employee;
  });
  return seeded;
}

function plan(ws: TestWorkspace, unit: OrchestrationUnit, inputId = 'IN-000001'): Plan {
  return createPlan(inputId, unit, { workspaceRoot: ws.root });
}

function reload(ws: TestWorkspace, id: string): Plan {
  const stored = getStores(ws.root).plans.getById(id);
  assert.ok(stored, `plan ${id} should exist`);
  return stored as Plan;
}

function events(ws: TestWorkspace, type: string) {
  return getStores(ws.root).events.loadAll().filter(e => e.type === type);
}

describe('v1.0.0 Slice C — Organizer core', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('examines pending plans once and converges on a no-change second pass', () => {
    const created = plan(ws, {
      title: 'Public API method',
      objective: 'Ship a public API method',
      implementation: 'Design and implement the method.'
    });
    const [ada] = seedAgents(ws, [
      { name: 'Ada', skills: [{ name: 'typescript', level: 3 }, { name: 'vscode-extension', level: 3 }, { name: 'apis', level: 3 }] }
    ]);

    const passOne = runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(passOne.examined, 1);
    assert.strictEqual(passOne.changed, 1);

    const organized = reload(ws, created.id);
    assert.strictEqual(organized.organization.status, 'organized');
    assert.strictEqual(organized.organization.version, 1);
    assert.match(organized.organization.decisionReason as string, /ready: agent Ada/);
    assert.strictEqual(organized.scheduling.status, 'ready');
    assert.strictEqual(organized.scheduling.mode, 'immediate');
    assert.strictEqual(organized.execution.status, 'assigned');
    assert.strictEqual(organized.execution.assignedAgent, ada.id);
    assert.strictEqual(organized.classification.current, undefined);

    assert.strictEqual(events(ws, 'plan.execution.requested').length, 1);
    assert.strictEqual(events(ws, 'organizer.pass.completed').length, 1);

    const passTwo = runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(passTwo.changed, 0);
    const afterTwo = reload(ws, created.id);
    assert.strictEqual(afterTwo.organization.version, 1);
    assert.strictEqual(events(ws, 'plan.execution.requested').length, 1);
    assert.strictEqual(events(ws, 'organizer.pass.completed').length, 2);
  });

  it('reclassifies evidence that contradicts the orchestrator seed and records classifiedBy + reason', () => {
    const created = plan(ws, {
      title: 'Checkout crash',
      objective: 'Fix the crash on checkout under low memory',
      implementation: 'Reproduce and debug the failure.'
    });
    assert.strictEqual(created.classification.original.category, 'feature');

    runOrganizerPass({ workspaceRoot: ws.root });
    const organized = reload(ws, created.id);

    assert.strictEqual(organized.classification.original.category, 'feature');
    const current = organized.classification.current;
    assert.ok(current, 'classification.current should be set');
    assert.strictEqual(current.category, 'bug');
    assert.strictEqual(current.urgency, 'normal'); // unaffected axes inherit original
    assert.strictEqual(current.classifiedBy.type, 'agent');
    assert.strictEqual(current.classifiedBy.id, 'organizer');
    assert.match(current.reason as string, /category=bug/);

    // Convergent — same pass again changes nothing.
    runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(reload(ws, created.id).organization.version, 1);
  });

  it('merges multi-axis evidence (category, urgency, priority, risk) into classification.current', () => {
    const created = plan(ws, {
      title: 'Checkout incident',
      objective: 'Fix the checkout crash by the deadline',
      implementation: 'urgent production issue affecting customers'
    });
    runOrganizerPass({ workspaceRoot: ws.root });
    const current = reload(ws, created.id).classification.current;
    assert.ok(current);
    assert.strictEqual(current.category, 'bug');
    assert.strictEqual(current.urgency, 'urgent');
    assert.strictEqual(current.priority, 'high');
    assert.strictEqual(current.risk, 'high');
  });

  it('dependency blocking: unsatisfied dependencies block, a satisfied dependency unblocks and requests execution', () => {
    const base = plan(ws, { title: 'Base layer', objective: 'Build the base API layer', implementation: 'foundation work' });
    const consumer = plan(ws, {
      title: 'Consumer',
      objective: 'Consume the base layer',
      implementation: 'Implement the consumer. Depends on PLAN-000001.'
    });
    const [grace] = seedAgents(ws, [
      { name: 'Grace', skills: [{ name: 'typescript', level: 3 }, { name: 'vscode-extension', level: 3 }, { name: 'apis', level: 3 }] }
    ]);

    runOrganizerPass({ workspaceRoot: ws.root });
    const blocked = reload(ws, consumer.id);
    assert.strictEqual(blocked.organization.status, 'blocked');
    assert.strictEqual(blocked.scheduling.status, 'blocked');
    assert.strictEqual(blocked.scheduling.mode, 'dependency');
    assert.deepStrictEqual(blocked.scheduling.dependsOn, [base.id]);
    assert.strictEqual(blocked.execution.status, 'unassigned');

    const delayed = events(ws, 'plan.execution.delayed');
    assert.ok(delayed.some(e => e.payload.planId === consumer.id));
    // The base plan carries no conflicting evidence, so Grace already qualifies.
    assert.strictEqual(events(ws, 'plan.execution.requested').length, 1);

    // Fulfil the dependency, then re-run: the consumer becomes runnable.
    getStores(ws.root).plans.update(base.id, { execution: { ...reload(ws, base.id).execution, status: 'completed' } });
    runOrganizerPass({ workspaceRoot: ws.root });

    const runnable = reload(ws, consumer.id);
    assert.strictEqual(runnable.organization.status, 'organized');
    assert.strictEqual(runnable.scheduling.status, 'ready');
    assert.strictEqual(runnable.execution.status, 'assigned');
    assert.strictEqual(runnable.execution.assignedAgent, grace.id);

    const requested = events(ws, 'plan.execution.requested');
    assert.deepStrictEqual(requested.map(e => e.payload.planId), [base.id, consumer.id]);
  });

  it('reconciles a stale analyzing state left by a crashed earlier pass', () => {
    const created = plan(ws, { title: 'Retry', objective: 'Retry the failed pipeline stage', implementation: 'Retry logic' });
    const stores = getStores(ws.root);
    stores.plans.update(created.id, {
      organization: { ...created.organization, status: 'analyzing' }
    });

    runOrganizerPass({ workspaceRoot: ws.root });
    const reconciled = reload(ws, created.id);
    assert.strictEqual(reconciled.organization.status, 'organized');
    assert.strictEqual(reconciled.organization.version, 1);
  });

  it('escalates fundamentally-wrong plans, requests replanning once, and never writes content', () => {
    const empty = plan(ws, { title: 'Empty', objective: '' });
    const impossible = plan(ws, {
      title: 'Impossible',
      objective: 'Ship an out-of-scope thing',
      constraints: 'This objective is impossible.'
    });

    const beforeEmpty = fs.readFileSync(planMdPath(empty.id, ws.root), 'utf8');
    const beforeImpossible = fs.readFileSync(planMdPath(impossible.id, ws.root), 'utf8');

    runOrganizerPass({ workspaceRoot: ws.root });

    const escalatedEmpty = reload(ws, empty.id);
    assert.strictEqual(escalatedEmpty.organization.status, 'escalated');
    assert.match(escalatedEmpty.organization.decisionReason as string, /objective-missing/);
    assert.strictEqual(escalatedEmpty.execution.status, 'unassigned');

    const escalatedImpossible = reload(ws, impossible.id);
    assert.strictEqual(escalatedImpossible.organization.status, 'escalated');
    assert.match(escalatedImpossible.organization.decisionReason as string, /impossible/);

    const replans = events(ws, 'plan.replanning.requested');
    assert.strictEqual(replans.length, 2);
    assert.deepStrictEqual(replans.map(e => e.payload.planId), [empty.id, impossible.id]);

    // No content writes — bytes are identical and no new plan artifacts appear.
    assert.strictEqual(fs.readFileSync(planMdPath(empty.id, ws.root), 'utf8'), beforeEmpty);
    assert.strictEqual(fs.readFileSync(planMdPath(impossible.id, ws.root), 'utf8'), beforeImpossible);

    runOrganizerPass({ workspaceRoot: ws.root });
    assert.strictEqual(events(ws, 'plan.replanning.requested').length, 2);
    assert.strictEqual(reload(ws, empty.id).organization.version, 1);
  });

  it('is idempotent across three passes with no underlying state change', () => {
    plan(ws, { title: 'A', objective: 'Implement A', implementation: 'Add A' });
    plan(ws, { title: 'B', objective: 'Fix B crash', implementation: 'Debug B' });
    seedAgents(ws, [
      { name: 'Lin', skills: [{ name: 'typescript', level: 3 }, { name: 'vscode-extension', level: 3 }, { name: 'apis', level: 3 }] },
      { name: 'Rai', skills: [{ name: 'debugging', level: 3 }] }
    ]);

    runOrganizerPass({ workspaceRoot: ws.root });

    const decisionEvents = ['plan.execution.requested', 'plan.execution.delayed', 'plan.replanning.requested'];
    for (const type of decisionEvents) {
      assert.ok(events(ws, type).length <= 2, `${type} emitted at most once per plan`);
    }
    assert.strictEqual(events(ws, 'plan.replanning.requested').length, 0);
    assert.deepStrictEqual(
      events(ws, 'plan.execution.requested').map(e => e.payload.planId).sort(),
      ['PLAN-000001', 'PLAN-000002']
    );
    assert.strictEqual(events(ws, 'plan.execution.delayed').length, 0);

    const snapshot = () =>
      getStores(ws.root)
        .plans.loadAll()
        .map(p => ({
          version: p.organization.version,
          org: p.organization.status,
          sched: p.scheduling.status,
          mode: p.scheduling.mode,
          exec: p.execution.status,
          agent: p.execution.assignedAgent
        }));

    const afterFirst = snapshot();
    runOrganizerPass({ workspaceRoot: ws.root });
    runOrganizerPass({ workspaceRoot: ws.root });
    assert.deepStrictEqual(snapshot(), afterFirst);

    // Only the guaranteed bookkeeping event accrues on repeated passes.
    assert.strictEqual(events(ws, 'organizer.pass.completed').length, 3);
  });

  it('registry-only: content protection — a reclassifying pass leaves plan markdown byte-identical', () => {
    const created = plan(ws, {
      title: 'Crash fix',
      objective: 'Fix the crash in the billing flow',
      implementation: 'Implement the fix'
    });
    const file = planMdPath(created.id, ws.root);
    const before = fs.readFileSync(file, 'utf8');
    const filesBefore = fs.readdirSync(path.join(ws.root, '.SprintDesk', 'plans')).length;

    runOrganizerPass({ workspaceRoot: ws.root });

    assert.strictEqual(reload(ws, created.id).classification.current?.category, 'bug');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(fs.readdirSync(path.join(ws.root, '.SprintDesk', 'plans')).length, filesBefore);
    assert.ok(!before.includes('classifiedBy'), 'plan content must never carry registry classification state');
  });

  it('selects an agent from seeded people/skills and reports awaiting-agent when none qualify', () => {
    const buggy = plan(ws, { title: 'Fix', objective: 'Fix the crash in checkout', implementation: 'Debug' });
    runOrganizerPass({ workspaceRoot: ws.root });

    const awaited = reload(ws, buggy.id);
    assert.strictEqual(awaited.organization.status, 'organized');
    assert.strictEqual(awaited.execution.status, 'unassigned');
    assert.match(awaited.organization.decisionReason as string, /awaiting-agent/);
    const delayed = events(ws, 'plan.execution.delayed');
    assert.ok(delayed.some(e => e.payload.planId === buggy.id));

    // Seed a debugging-capable agent → the same plan gets assigned on the next pass.
    const [rai] = seedAgents(ws, [{ name: 'Rai', skills: [{ name: 'debugging', level: 3 }] }]);
    runOrganizerPass({ workspaceRoot: ws.root });

    const assigned = reload(ws, buggy.id);
    assert.strictEqual(assigned.execution.status, 'assigned');
    assert.strictEqual(assigned.execution.assignedAgent, rai.id);
    assert.deepStrictEqual(assigned.execution.assignmentReason?.capability, ['debugging']);
    assert.strictEqual(events(ws, 'plan.execution.requested').length, 1);
  });

  it('mode selection: scheduled and blocked execution modes delay or block scheduling', () => {
    const nightly = plan(ws, {
      title: 'Nightly report',
      objective: 'Run the nightly report',
      implementation: 'batch job',
      classification: { executionMode: 'scheduled' }
    });
    const manual = plan(ws, {
      title: 'Manual deploy',
      objective: 'Stage gated work',
      implementation: 'blocked until approval',
      classification: { executionMode: 'blocked' }
    });

    runOrganizerPass({ workspaceRoot: ws.root });

    const scheduled = reload(ws, nightly.id);
    assert.strictEqual(scheduled.organization.status, 'organized');
    assert.strictEqual(scheduled.scheduling.status, 'ready');
    assert.strictEqual(scheduled.scheduling.mode, 'scheduled');
    assert.strictEqual(scheduled.execution.status, 'unassigned');

    const blocked = reload(ws, manual.id);
    assert.strictEqual(blocked.organization.status, 'blocked');
    assert.strictEqual(blocked.scheduling.status, 'blocked');
    assert.match(blocked.organization.decisionReason as string, /execution-mode-blocked/);

    const delayed = events(ws, 'plan.execution.delayed');
    assert.deepStrictEqual(delayed.map(e => e.payload.planId), [nightly.id, manual.id]);
    assert.strictEqual(events(ws, 'plan.execution.requested').length, 0);
  });

  it('triggerOrganizer emits organizer.trigger before the pass', () => {
    plan(ws, { title: 'T', objective: 'Add a trivial feature', implementation: 'Add it' });
    seedAgents(ws, [
      { name: 'Pat', skills: [{ name: 'typescript', level: 3 }, { name: 'vscode-extension', level: 3 }, { name: 'apis', level: 3 }] }
    ]);
    triggerOrganizer({ workspaceRoot: ws.root });
    assert.strictEqual(events(ws, 'organizer.trigger').length, 1);
    assert.strictEqual(events(ws, 'organizer.pass.completed').length, 1);
    assert.ok(events(ws, 'plan.execution.requested').length === 1);
  });

  it('honors a planIds selector and leaves other plans untouched', () => {
    const a = plan(ws, { title: 'A', objective: 'Implement A', implementation: 'Add A' });
    const b = plan(ws, { title: 'B', objective: 'Implement B', implementation: 'Add B' });

    const result = runOrganizerPass({ workspaceRoot: ws.root, planIds: [a.id] });
    assert.strictEqual(result.examined, 1);
    assert.strictEqual(reload(ws, a.id).organization.status, 'organized');
    assert.strictEqual(reload(ws, b.id).organization.status, 'pending');
  });

  it('analyzeContent is a pure deterministic classifier over sections', () => {
    assert.strictEqual(
      analyzeContent({ objective: 'Fix the crash in checkout', implementation: '', acceptanceCriteria: '', constraints: '' }).evidence.category,
      'bug'
    );
    assert.deepStrictEqual(
      analyzeContent({ objective: 'run docs for the api', implementation: 'background job', acceptanceCriteria: '', constraints: '' }).axisReasons,
      analyzeContent({ objective: 'run docs for the api', implementation: 'background job', acceptanceCriteria: '', constraints: '' }).axisReasons
    );
    const deps = analyzeContent({ objective: 'consume PLAN-000002', implementation: 'uses PLAN-000002', acceptanceCriteria: '', constraints: '' });
    assert.deepStrictEqual(deps.depIdRefs, ['PLAN-000002']);
  });
});