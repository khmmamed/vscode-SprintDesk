import { strict as assert } from 'node:assert';
import { makeEmployee, makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { createPlan } from '../../src/services/workforce/orchestrator';
import { enqueuePlan } from '../../src/services/workforce/plan/dispatcher';
import { finishRun, startRun } from '../../src/services/workforce/queueService';
import {
  deriveValidationRecord,
  installValidator,
  requestDeployForCheckpoint,
  validateCompletedRun
} from '../../src/services/workforce/plan/validator';
import { emitEvent } from '../../src/services/workforce/events';
import { CHECKPOINT_HANDLERS } from '../../src/mcp/handlers/checkpoints';
import { Approval, Checkpoint, Employee, EventRecord, Plan, Run } from '../../src/data/types';

let inputSequence = 0;

function nextInputId(): string {
  inputSequence += 1;
  return `IN-${Date.now()}-${inputSequence}`;
}

function seedAgent(ws: TestWorkspace, name: string): Employee {
  const employee = makeEmployee({
    role: 'agent',
    name,
    status: 'idle',
    capabilities: ['typescript', 'vscode-extension', 'apis'],
    skills: [
      { name: 'typescript', level: 3 },
      { name: 'vscode-extension', level: 3 },
      { name: 'apis', level: 3 }
    ]
  });
  getStores(ws.root).people.add(employee);
  return employee;
}

function seedHuman(ws: TestWorkspace, name: string): Employee {
  const employee = makeEmployee({ role: 'human', name, teamRole: 'human', status: 'idle' });
  getStores(ws.root).people.add(employee);
  return employee;
}

// A plan + queued Run in exactly the state the Dispatcher would create.
function workable(ws: TestWorkspace, agent: Employee, title: string): { plan: Plan; run: Run } {
  const created = createPlan(
    nextInputId(),
    { title, objective: `${title} objective`, implementation: 'Implement it end to end.' },
    { workspaceRoot: ws.root }
  );
  getStores(ws.root).plans.update(created.id, {
    organization: { ...created.organization, status: 'organized', version: 1 },
    scheduling: { ...created.scheduling, status: 'ready', mode: 'immediate' },
    execution: { ...created.execution, status: 'assigned', assignedAgent: agent.id }
  });
  const outcome = enqueuePlan(created.id);
  assert.strictEqual(outcome.action, 'enqueued');
  const plan = getStores(ws.root).plans.getById(created.id) as Plan;
  const run = getStores(ws.root).runs.getById(outcome.runId as string) as Run;
  return { plan, run };
}

// Completed run with no reported errors.
function completePlan(ws: TestWorkspace, runId: string): void {
  startRun(runId);
  finishRun(runId, { status: 'completed', classification: 'none', result: 'findings: 0\nerrors: 0\nall checks passed' });
}

// Completed run that reported errors -> validator must route to recovery.
function completeWithErrors(ws: TestWorkspace, runId: string): void {
  startRun(runId);
  finishRun(runId, { status: 'completed', classification: 'none', result: 'errors:\n- acceptance criteria not met' });
}

function eventTypes(ws: TestWorkspace): Set<string> {
  return new Set(getStores(ws.root).events.loadAll().map(e => e.type));
}

function eventsOf(ws: TestWorkspace, type: string): EventRecord[] {
  return getStores(ws.root).events.loadAll().filter(e => e.type === type);
}

function checkpoints(ws: TestWorkspace, planId: string): Checkpoint[] {
  return getStores(ws.root).checkpoints.byPlanId(planId);
}

function deployApprovalsFor(ws: TestWorkspace, checkpointId: string): Approval[] {
  return getStores(ws.root).approvals
    .loadAll()
    .filter(a => a.pending?.op === 'authorize-deploy' && a.pending.checkpointId === checkpointId);
}

function pendingDeployApprovalsFor(ws: TestWorkspace, checkpointId: string): Approval[] {
  return deployApprovalsFor(ws, checkpointId).filter(a => a.status === 'pending');
}

describe('v1.0.0 Slice J — Validation -> Checkpoint -> Deploy', () => {
  let ws: TestWorkspace;
  let disposeValidator: () => void;

  beforeEach(() => {
    ws = makeWorkspace();
    disposeValidator = installValidator();
  });

  afterEach(() => {
    disposeValidator();
    ws.cleanup();
  });

  it('1 — a completed run is validated and checkpointed automatically', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Auto validate success');

    completePlan(ws, run.id);

    const after = getStores(ws.root).plans.getById(plan.id) as Plan;
    assert.strictEqual(after.validation.decision, 'passed');
    assert.strictEqual(after.validation.runId, run.id, 'validation is keyed to the run for idempotence');

    const created = checkpoints(ws, plan.id);
    assert.strictEqual(created.length, 1, 'exactly one checkpoint is created');
    assert.strictEqual(created[0].runId, run.id);
    assert.strictEqual(created[0].validation?.decision, 'passed');

    const types = eventTypes(ws);
    assert.ok(types.has('plan.validation.recorded'));
    assert.ok(types.has('checkpoint.created'));
    assert.ok(types.has('cycle.closed'));

    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.strictEqual(cycle.outcome, 'closed-pass');
    assert.strictEqual(cycle.checkpointId, created[0].id);
  });

  it('2 — a completed run that reported errors is routed to recovery (no checkpoint)', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Auto validate revision');

    completeWithErrors(ws, run.id);

    const after = getStores(ws.root).plans.getById(plan.id) as Plan;
    assert.strictEqual(after.validation.decision, 'revision');
    assert.strictEqual(after.validation.runId, run.id);
    assert.deepStrictEqual(checkpoints(ws, plan.id), [], 'a revision must not create a checkpoint');

    const replans = getStores(ws.root).inputs
      .loadAll()
      .filter(i => i.source?.type === 'agent' && i.source.id === run.id);
    assert.strictEqual(replans.length, 1, 'revision writes exactly one replan input');
    assert.strictEqual(eventsOf(ws, 'plan.replanning.requested').length, 1);

    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.strictEqual(cycle.outcome, 'closed-fail');
  });

  it('3 — a created checkpoint requests the human deploy authorization', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Auto deploy request');

    completePlan(ws, run.id);

    const checkpoint = checkpoints(ws, plan.id)[0];
    assert.ok(checkpoint, 'checkpoint should exist');
    assert.strictEqual(checkpoint.status, 'deployment-authorizing', 'the manual gate is opened, never bypassed');

    const pending = pendingDeployApprovalsFor(ws, checkpoint.id);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].type, 'deploy-authorization');
    const op = pending[0].pending;
    assert.ok(op && op.op === 'authorize-deploy');
    assert.strictEqual(op.checkpointId, checkpoint.id);
    assert.strictEqual(op.planId, plan.id);
    assert.strictEqual(op.runId, run.id);

    // Requesting again is a no-op (existing authorization short-circuits).
    const again = requestDeployForCheckpoint(checkpoint.id);
    assert.strictEqual(again.reason, 'authorization-exists');
    assert.strictEqual(pendingDeployApprovalsFor(ws, checkpoint.id).length, 1);
  });

  it('4 — MCP approve handler deploys against the real pending authorization', async () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');
    const { plan, run } = workable(ws, agent, 'MCP approve deploy');

    completePlan(ws, run.id);
    const checkpoint = checkpoints(ws, plan.id)[0];

    const result = await CHECKPOINT_HANDLERS.sprintdesk_checkpointsApproveDeploy({
      checkpointId: checkpoint.id,
      actorId: human.id
    });

    assert.notStrictEqual(result.isError, true, 'handler must find the pending authorization');
    const deployed = getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint;
    assert.strictEqual(deployed.status, 'deployed');
    assert.strictEqual(deployed.deploymentDecision?.by, human.id);

    const types = eventTypes(ws);
    assert.ok(types.has('deploy.authorized'));
    assert.ok(types.has('checkpoint.deployed'));
  });

  it('5 — MCP reject handler returns the checkpoint to ready', async () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');
    const { plan, run } = workable(ws, agent, 'MCP reject deploy');

    completePlan(ws, run.id);
    const checkpoint = checkpoints(ws, plan.id)[0];

    const result = await CHECKPOINT_HANDLERS.sprintdesk_checkpointsRejectDeploy({
      checkpointId: checkpoint.id,
      actorId: human.id
    });

    assert.notStrictEqual(result.isError, true, 'handler must find the pending authorization');
    const afterReject = getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint;
    assert.strictEqual(afterReject.status, 'ready', 'a rejection is not a deploy');
    assert.strictEqual(eventsOf(ws, 'deploy.rejected').length, 1);

    // A rejected checkpoint is not re-requested by a duplicate checkpoint.created.
    emitEvent('checkpoint.created', 'test', { checkpointId: checkpoint.id, planId: plan.id, runId: run.id });
    assert.strictEqual(deployApprovalsFor(ws, checkpoint.id).length, 1, 'no duplicate authorization is minted');
    assert.strictEqual(pendingDeployApprovalsFor(ws, checkpoint.id).length, 0, 'the rejection stays resolved');
    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'ready');
  });

  it('6 — duplicate completion/validation events are idempotent', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Duplicate completion');

    completePlan(ws, run.id);

    const duplicate = validateCompletedRun(run.id, plan.id);
    assert.strictEqual(duplicate.decision, 'skipped');
    assert.strictEqual(duplicate.reason, 'already-validated');

    emitEvent('execution.completed', 'queue', { runId: run.id, planId: plan.id });
    emitEvent('execution.completed', 'queue', { runId: run.id, planId: plan.id });

    assert.strictEqual(checkpoints(ws, plan.id).length, 1, 'duplicates must not create a second checkpoint');
    assert.strictEqual(eventsOf(ws, 'checkpoint.created').length, 1);
    assert.strictEqual(pendingDeployApprovalsFor(ws, checkpoints(ws, plan.id)[0].id).length, 1);
  });

  it('7 — unrelated events do not validate or checkpoint', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan } = workable(ws, agent, 'Unrelated events');

    for (const type of ['run.finished', 'finding.created', 'organizer.trigger', 'schedule.tick', 'approval.requested']) {
      emitEvent(type, 'test', { planId: plan.id, runId: 'run_unknown' });
    }

    assert.deepStrictEqual(checkpoints(ws, plan.id), []);
    const after = getStores(ws.root).plans.getById(plan.id) as Plan;
    assert.strictEqual(after.validation.runId, undefined, 'no validation should have been recorded');
    assert.strictEqual(after.validation.decision, 'passed', 'plan default is untouched');
  });

  it('8 — deriveValidationRecord maps the run summary deterministically', () => {
    const agent = seedAgent(ws, 'Ada');
    const { run } = workable(ws, agent, 'Derive record');

    const clean: Run = { ...run, status: 'completed', summary: { findings: 0, errors: 0 } };
    assert.strictEqual(deriveValidationRecord(clean).decision, 'passed');

    const noisy: Run = { ...run, status: 'completed', summary: { findings: 2, errors: 3 } };
    const record = deriveValidationRecord(noisy);
    assert.strictEqual(record.decision, 'revision');
    assert.strictEqual(record.errors?.length, 1);
  });
});
