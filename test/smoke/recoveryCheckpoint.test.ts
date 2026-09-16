import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeEmployee, makeRun, makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { createPlan } from '../../src/services/workforce/orchestrator';
import { enqueuePlan } from '../../src/services/workforce/plan/dispatcher';
import { finishRun, startRun } from '../../src/services/workforce/queueService';
import {
  classifyFailure,
  decideRecovery,
  installRecovery,
  recoverFailure
} from '../../src/services/workforce/plan/recovery';
import {
  authorizeDeploy,
  createCheckpoint,
  onDeployRejected,
  recordValidation,
  requestDeployAuthorization
} from '../../src/services/workforce/plan/checkpointService';
import { approve, reject } from '../../src/services/workforce/approvals';
import { emitEvent } from '../../src/services/workforce/events';
import { RunFailureClassification } from '../../src/services/workforce/queueService';
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

// Builds a plan + queued Run in exactly the state the Dispatcher would create.
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

function failRun(ws: TestWorkspace, runId: string, classification: RunFailureClassification, error = 'command failed'): void {
  startRun(runId);
  finishRun(runId, { status: 'failed', classification, error });
}

function completePlan(ws: TestWorkspace, runId: string): void {
  startRun(runId);
  finishRun(runId, { status: 'completed', classification: 'none', result: 'findings: 0\nerrors: 0\nall checks passed' });
}

function eventTypes(ws: TestWorkspace): Set<string> {
  return new Set(getStores(ws.root).events.loadAll().map(e => e.type));
}

function eventsOf(ws: TestWorkspace, type: string): EventRecord[] {
  return getStores(ws.root).events.loadAll().filter(e => e.type === type);
}

function runById(ws: TestWorkspace, id: string): Run {
  const run = getStores(ws.root).runs.getById(id);
  assert.ok(run, `run ${id} should exist`);
  return run;
}

describe('v1.0.0 Slice G — Recovery/Checkpoint/Deploy', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('1 — classifies execution failures: retryable requeue, non-retryable replan, exhausted retries replan', () => {
    const agent = seedAgent(ws, 'Ada');
    const plan = createPlan(
      nextInputId(),
      { title: 'Classification fixture', objective: 'Classification objective', implementation: 'x' },
      { workspaceRoot: ws.root }
    );

    assert.strictEqual(classifyFailure('exit-nonzero'), 'retryable');
    assert.strictEqual(classifyFailure('timeout'), 'retryable');
    assert.strictEqual(classifyFailure(undefined), 'retryable');
    assert.strictEqual(classifyFailure('spawn-error'), 'non-retryable');
    assert.strictEqual(classifyFailure('invalid-config'), 'non-retryable');

    const retryable = makeRun(plan.id, agent.id, { status: 'failed', attempts: 1 });
    const nonRetryable = makeRun(plan.id, agent.id, { status: 'failed', attempts: 1 });
    const exhausted = makeRun(plan.id, agent.id, { status: 'failed', attempts: 2 });
    const running = makeRun(plan.id, agent.id, { status: 'running', attempts: 1 });

    assert.strictEqual(decideRecovery(runById(ws, retryable.id), 'exit-nonzero'), 'requeue');
    assert.strictEqual(decideRecovery(runById(ws, retryable.id), 'none'), 'requeue', 'none classification is retryable');
    assert.strictEqual(decideRecovery(runById(ws, nonRetryable.id), 'spawn-error'), 'replan');
    assert.strictEqual(decideRecovery(runById(ws, nonRetryable.id), 'invalid-config'), 'replan');
    assert.strictEqual(decideRecovery(runById(ws, exhausted.id), 'exit-nonzero'), 'replan', 'retries exhausted -> replan');
    assert.strictEqual(decideRecovery(runById(ws, running.id), 'exit-nonzero'), 'none', 'non-failed runs are not recoverable');
  });

  it('2 — requeue recovery: retry-eligible failure requeues the same run with backoff and keeps the cycle open', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Requeue target');
    failRun(ws, run.id, 'exit-nonzero');

    const outcome = recoverFailure({ planId: plan.id, runId: run.id, classification: 'exit-nonzero' });
    assert.strictEqual(outcome.decision, 'requeue');
    assert.strictEqual(outcome.attempt, 2);

    const requeued = runById(ws, run.id);
    assert.strictEqual(requeued.status, 'queued');
    assert.strictEqual(requeued.attempts, 2);
    assert.ok(requeued.availableAt, 'backoff availableAt should be set');
    assert.ok(new Date(requeued.availableAt as string).getTime() > Date.now() - 1000);

    const after = getStores(ws.root).plans.getById(plan.id) as Plan;
    assert.strictEqual(after.execution.status, 'assigned', 'queue can re-claim the retried plan');

    const types = eventTypes(ws);
    assert.ok(types.has('plan.failure.classified'));
    assert.ok(types.has('plan.requeued'));
    assert.ok(types.has('run.retried'));

    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.ok(cycle, 'cycle should exist');
    assert.strictEqual(cycle.outcome, 'open', 'a retryable requeue does not close the lifecycle');
  });

  it('3 — replan recovery: exhausted/non-retryable failure writes a new input artifact + InputRecord and closes the cycle', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Replan source');
    failRun(ws, run.id, 'spawn-error');

    const outcome = recoverFailure({ planId: plan.id, runId: run.id, classification: 'spawn-error' });
    assert.strictEqual(outcome.decision, 'replan');
    assert.ok(outcome.inputId, 'a replan input should be minted');

    const input = getStores(ws.root).inputs.getById(outcome.inputId as string);
    assert.ok(input);
    assert.strictEqual(input.status, 'new');
    assert.strictEqual(input.source?.type, 'agent');
    assert.strictEqual(input.source?.id, run.id, 'input lineage keys the replan to its source run');
    assert.strictEqual(input.file, `inputs/replan-${run.id}.md`);

    const artifact = path.join(ws.root, '.SprintDesk', input.file);
    assert.ok(fs.existsSync(artifact), 'replan artifact should exist on disk');
    const content = fs.readFileSync(artifact, 'utf8');
    assert.match(content, /objective:/, 'replan artifact re-decomposes the original objective');

    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.ok(cycle);
    assert.strictEqual(cycle.outcome, 'closed-fail', 'escalation sets cycle.outcome');
    assert.ok(cycle.closedAt);

    const types = eventTypes(ws);
    assert.ok(types.has('plan.failure.classified'));
    assert.ok(types.has('plan.replanning.requested'));
    assert.ok(types.has('input.created'));
    assert.ok(types.has('cycle.closed'));
  });

  it('4 — validation pass writes a ready checkpoint; validation is never authority', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Validate pass');
    completePlan(ws, run.id);
    assert.strictEqual((getStores(ws.root).plans.getById(plan.id) as Plan).execution.status, 'completed');

    recordValidation(plan.id, {
      decision: 'passed',
      artifacts: ['dist/release.zip'],
      evidence: ['lint: clean', 'tests: 12 passing'],
      validatorId: agent.id
    });

    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0];
    assert.ok(checkpoint, 'a passed validation must create a checkpoint');
    assert.strictEqual(checkpoint.status, 'ready');
    assert.strictEqual(checkpoint.planId, plan.id);
    assert.deepStrictEqual(checkpoint.artifacts, ['dist/release.zip']);
    assert.strictEqual(checkpoint.validation?.decision, 'passed');
    assert.deepStrictEqual(checkpoint.validation?.evidence, ['lint: clean', 'tests: 12 passing']);
    assert.ok(checkpoint.validation?.validatedAt);

    const after = getStores(ws.root).plans.getById(plan.id) as Plan;
    assert.strictEqual(after.validation.decision, 'passed');

    const types = eventTypes(ws);
    assert.ok(types.has('plan.validation.recorded'));
    assert.ok(types.has('checkpoint.created'));
    assert.ok(types.has('cycle.closed'));
  });

  it('5 — validation failure routed to recovery replan (never silent re-runnable)', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Validate revision');
    completePlan(ws, run.id);

    recordValidation(plan.id, { decision: 'revision', errors: ['acceptance criteria not met'], artifacts: [] });

    const replans = getStores(ws.root).inputs
      .loadAll()
      .filter(i => i.source?.type === 'agent' && i.source.id === run.id);
    assert.strictEqual(replans.length, 1, 'validation failure must create exactly one replan input');
    assert.ok(eventsOf(ws, 'plan.replanning.requested').length === 1);

    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.strictEqual(cycle.outcome, 'closed-fail');
  });

  it('6 — lineage: planId -> runId -> checkpoint is preserved in the checkpoint record', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Lineage chain');
    completePlan(ws, run.id);

    recordValidation(plan.id, { decision: 'passed', artifacts: ['out.zip'], validatorId: agent.id });
    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0];
    assert.ok(checkpoint);
    assert.strictEqual(checkpoint.planId, plan.id);
    assert.strictEqual(checkpoint.runId, run.id);
    assert.strictEqual((getStores(ws.root).plans.getById(plan.id) as Plan).execution.runId, run.id);
    if (checkpoint.gitCommit !== undefined) {
      assert.strictEqual(typeof checkpoint.gitCommit, 'string');
    }
    if (checkpoint.gitRef !== undefined) {
      assert.strictEqual(typeof checkpoint.gitRef, 'string');
    }
  });

  it('7 — cycle closes at a passing checkpoint: closed-pass pins the checkpointId', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Cycle close');
    completePlan(ws, run.id);
    recordValidation(plan.id, { decision: 'passed', artifacts: [], validatorId: agent.id });

    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0] as Checkpoint;
    const cycle = getStores(ws.root).cycles.byPlanId(plan.id)[0];
    assert.ok(cycle);
    assert.strictEqual(cycle.outcome, 'closed-pass');
    assert.strictEqual(cycle.checkpointId, checkpoint.id);
    assert.ok(cycle.closedAt, 'closedAt should be pinned');
    assert.ok(cycle.planIds.includes(plan.id));

    const closed = eventsOf(ws, 'cycle.closed').find(e => e.payload.planId === plan.id);
    assert.ok(closed, 'cycle.closed event should carry the plan');
    assert.strictEqual(closed.payload.outcome, 'closed-pass');
    assert.strictEqual(closed.payload.checkpointId, checkpoint.id);
  });

  it('8 — recovery and checkpoint creation are idempotent under duplicate calls and events', () => {
    const agent = seedAgent(ws, 'Ada');

    // Duplicate direct recovery (replan) calls produce a single input.
    const { plan: p1, run: r1 } = workable(ws, agent, 'Idempotent replan');
    failRun(ws, r1.id, 'exit-nonzero');
    getStores(ws.root).runs.update(r1.id, { attempts: 2 });
    const first = recoverFailure({ planId: p1.id, runId: r1.id, classification: 'exit-nonzero' });
    assert.strictEqual(first.decision, 'replan');
    const second = recoverFailure({ planId: p1.id, runId: r1.id, classification: 'exit-nonzero' });
    assert.strictEqual(second.decision, 'none');
    assert.strictEqual(second.reason, 'already-replanned');
    assert.strictEqual(second.inputId, first.inputId);
    const replansForRun = getStores(ws.root).inputs
      .loadAll()
      .filter(i => i.source?.type === 'agent' && i.source.id === r1.id);
    assert.strictEqual(replansForRun.length, 1);
    assert.strictEqual(eventsOf(ws, 'plan.replanning.requested').length, 1);

    // Duplicate checkpoint creation returns the same checkpoint, no second event.
    const { plan: p2, run: r2 } = workable(ws, agent, 'Idempotent checkpoint');
    completePlan(ws, r2.id);
    recordValidation(p2.id, { decision: 'passed', artifacts: [], validatorId: agent.id });
    const original = getStores(ws.root).checkpoints.byPlanId(p2.id)[0];
    const duplicate = createCheckpoint(p2.id, { runId: r2.id, artifacts: [], validatorId: agent.id });
    assert.strictEqual(duplicate.id, original.id);
    assert.strictEqual(eventsOf(ws, 'checkpoint.created').length, 1);
  });

  it('8b — plan.failed event wiring runs recovery; re-emitting the event cannot double-recover', () => {
    const agent = seedAgent(ws, 'Ada');
    const { plan, run } = workable(ws, agent, 'Event driven');
    startRun(run.id);
    finishRun(run.id, { status: 'failed', classification: 'invalid-config', error: 'bad config' });

    const dispose = installRecovery();
    try {
      const event: EventRecord = {
        id: `evt_test_${Date.now()}`,
        type: 'plan.failed',
        source: 'queue',
        payload: { runId: run.id, planId: plan.id, classification: 'invalid-config' },
        timestamp: new Date().toISOString()
      };
      emitEvent(event.type, event.source, event.payload);
      emitEvent(event.type, event.source, event.payload);

      const inputs = getStores(ws.root).inputs
        .loadAll()
        .filter(i => i.source?.type === 'agent' && i.source.id === run.id);
      assert.strictEqual(inputs.length, 1, 'plan.failed must recover exactly once');
      assert.ok(eventsOf(ws, 'plan.failure.classified').length >= 1);
      assert.strictEqual(eventsOf(ws, 'plan.replanning.requested').length, 1);
    } finally {
      dispose();
    }
  });

  it('9 — deploy requires human gate: manual approval must pass before a checkpoint deploys', () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');

    const { plan, run } = workable(ws, agent, 'Deploy gate');
    completePlan(ws, run.id);
    recordValidation(plan.id, { decision: 'passed', artifacts: ['dist/app.zip'], validatorId: agent.id });
    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0];
    assert.strictEqual(checkpoint.status, 'ready');

    const pending = requestDeployAuthorization(checkpoint.id, { requesterId: agent.id });
    assert.strictEqual(pending.status, 'deployment-authorizing');
    assert.ok(pending.approvalId);

    const approval = getStores(ws.root).approvals.getById(pending.approvalId as string);
    assert.ok(approval);
    assert.strictEqual(approval.type, 'deploy-authorization');
    assert.strictEqual(approval.status, 'pending');
    assert.strictEqual(approval.pending.op, 'authorize-deploy');

    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'deployment-authorizing');

    const resolved = approve(approval.id, human.id) as Approval | undefined;
    assert.ok(resolved);
    assert.strictEqual(resolved!.status, 'approved');

    const deployed = getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint;
    assert.strictEqual(deployed.status, 'deployed');
    assert.strictEqual(deployed.deploymentDecision?.by, human.id);
    assert.ok(deployed.deploymentDecision?.at);

    const types = eventTypes(ws);
    assert.ok(types.has('approval.requested'));
    assert.ok(types.has('approval.resolved'));
    assert.ok(types.has('deploy.authorized'));
    assert.ok(types.has('checkpoint.deployed'));
  });

  it('10 — unauthorized deployment is rejected: no plan:deploy permission, no approval:review', () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');
    const { plan, run } = workable(ws, agent, 'Blocked deploy');
    completePlan(ws, run.id);
    recordValidation(plan.id, { decision: 'passed', artifacts: [], validatorId: agent.id });
    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0];

    assert.throws(() => authorizeDeploy(checkpoint.id, agent.id), /lacks permission 'plan:deploy'/);
    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'ready');

    const pending = requestDeployAuthorization(checkpoint.id, { requesterId: agent.id });
    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'deployment-authorizing');

    assert.throws(() => authorizeDeploy(checkpoint.id), /explicit human actor/);
    assert.throws(() => approve(pending.approvalId as string, agent.id), /lacks permission 'approval:review'/);

    // Human can still complete the flow so the checkpoint is deployable by design.
    approve(pending.approvalId as string, human.id);
    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'deployed');
  });

  it('11 — rejecting the deploy approval leaves the checkpoint ready and records deploy.rejected', () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');

    const { plan, run } = workable(ws, agent, 'Reject deploy');
    completePlan(ws, run.id);
    recordValidation(plan.id, { decision: 'passed', artifacts: [], validatorId: agent.id });
    const checkpoint = getStores(ws.root).checkpoints.byPlanId(plan.id)[0];

    const pending = requestDeployAuthorization(checkpoint.id, { requesterId: agent.id });
    assert.strictEqual((getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint).status, 'deployment-authorizing');

    const resolved = reject(pending.approvalId as string, human.id);
    assert.ok(resolved);
    assert.strictEqual(resolved!.status, 'rejected');

    const afterReject = getStores(ws.root).checkpoints.getById(checkpoint.id) as Checkpoint;
    assert.strictEqual(afterReject.status, 'ready', 'reject keeps the checkpoint ready');
    assert.ok(eventsOf(ws, 'deploy.rejected').length === 1);

    onDeployRejected(checkpoint.id, { by: human.id });
    assert.strictEqual(eventsOf(ws, 'deploy.rejected').length, 2);
  });

  it('12 — audit and event records cover the full lifecycle (recovery, checkpoint, deploy)', () => {
    const agent = seedAgent(ws, 'Ada');
    const human = seedHuman(ws, 'Hana');

    // Failed plan → replan input.
    const { plan: pFail, run: rFail } = workable(ws, agent, 'Audit replan');
    failRun(ws, rFail.id, 'exit-nonzero');
    getStores(ws.root).runs.update(rFail.id, { attempts: 2 });
    recoverFailure({ planId: pFail.id, runId: rFail.id, classification: 'exit-nonzero' });

    // Passing plan → checkpoint → human-deployed.
    const { plan: pPass, run: rPass } = workable(ws, agent, 'Audit deploy');
    completePlan(ws, rPass.id);
    recordValidation(pPass.id, { decision: 'passed', artifacts: ['dist/audit.zip'], validatorId: agent.id });
    const checkpoint = getStores(ws.root).checkpoints.byPlanId(pPass.id)[0];
    const pending = requestDeployAuthorization(checkpoint.id, { requesterId: agent.id });
    approve(pending.approvalId as string, human.id);

    const types = eventTypes(ws);
    for (const type of [
      'plan.failure.classified',
      'plan.replanning.requested',
      'plan.validation.recorded',
      'checkpoint.created',
      'cycle.closed',
      'approval.requested',
      'approval.resolved',
      'deploy.authorized',
      'checkpoint.deployed'
    ]) {
      assert.ok(types.has(type), `event ${type} should have been emitted`);
    }

    const auditActions = new Set(getStores(ws.root).audit.loadAll().map((a: any) => a.action));
    assert.ok(auditActions.has('plan.replan'));
    assert.ok(auditActions.has('checkpoint.create'));
    assert.ok(auditActions.has('deploy.authorize'));
    assert.ok(auditActions.has('approval.approved'));
  });
});