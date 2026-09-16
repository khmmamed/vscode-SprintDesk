import { getStores } from '../../../data/stores';
import { Checkpoint, Plan, PlanValidationDecision } from '../../../data/types';
import { getHost } from '../../../host';
import { getWorkspaceRoot } from '../../fileService';
import { emitEvent } from '../events';
import { requestApproval } from '../gates';
import { requireEmployeePermission } from '../capabilityService';
import { recoverFailure } from './recovery';

const EVENT_SOURCE = 'checkpoints';

// v1.0 Slice G — Checkpointing + deploy authorization. A validator pass that
// passes closes a `CHK-####` checkpoint (status `ready`) and its lifecycle
// Cycle (`closed-pass`). Checkpoints are never authority: only an explicit
// human authorization (existing approval flow, op `authorize-deploy`, under the
// `plan:deploy` permission) moves a checkpoint to `deployed`.

export interface GitRefInfo {
  gitRef?: string;
  gitCommit?: string;
}

export function gitRefInfo(workspaceRoot?: string): GitRefInfo {
  const root = workspaceRoot || getWorkspaceRoot() || process.cwd();
  try {
    const gitRef = getHost().execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).stdout.trim();
    const gitCommit = getHost().execSync('git rev-parse HEAD', { cwd: root }).stdout.trim();
    return { gitRef: gitRef || undefined, gitCommit: gitCommit || undefined };
  } catch {
    // not a git checkout (or git unavailable) — ref capture is best-effort
    return {};
  }
}

function recordAudit(entry: { actor: string; action: string; targetType: string; targetId: string; details?: Record<string, unknown> }): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString()
  } as any);
}

export interface ValidationRecord {
  decision: PlanValidationDecision;
  errors?: string[];
  artifacts?: string[];
  evidence?: string[];
  validatorId?: string;
}

// The validator pass. Records the decision on the plan registry and then routes:
//   passed  -> checkpoint + closed-pass cycle
//   failed/revision -> recovery replan (never auto-runs the same work again)
export function recordValidation(planId: string, record: ValidationRecord): Plan | undefined {
  const stores = getStores();
  const plan = stores.plans.getById(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  const now = new Date().toISOString();
  stores.plans.update(plan.id, {
    validation: {
      decision: record.decision,
      errors: record.errors || [],
      artifacts: record.artifacts || []
    },
    updatedAt: now
  });

  emitEvent('plan.validation.recorded', EVENT_SOURCE, {
    planId: plan.id,
    decision: record.decision,
    ...(record.validatorId ? { validatorId: record.validatorId } : {})
  });

  if (record.decision === 'passed') {
    createCheckpoint(plan.id, {
      runId: plan.execution.runId,
      artifacts: record.artifacts || [],
      evidence: record.evidence || [],
      validatorId: record.validatorId
    });
  } else if (record.decision === 'failed' || record.decision === 'revision') {
    recoverFailure({
      planId: plan.id,
      runId: plan.execution.runId || '',
      decision: 'replan',
      reason: `validation:${record.decision}`
    });
  }

  return getStores().plans.getById(plan.id);
}

export interface CreateCheckpointOptions {
  runId?: string;
  artifacts?: string[];
  evidence?: string[];
  validatorId?: string;
  workspaceRoot?: string;
}

export function createCheckpoint(planId: string, opts: CreateCheckpointOptions = {}): Checkpoint {
  const stores = getStores();
  const plan = stores.plans.getById(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  const runId = opts.runId || plan.execution.runId;
  const existing = stores.checkpoints
    .byPlanId(planId)
    .find(c => c.status === 'ready' && (runId === undefined || c.runId === runId));
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const git = gitRefInfo(opts.workspaceRoot);
  const checkpoint: Checkpoint = {
    id: stores.checkpoints.nextId(),
    planId: plan.id,
    runId,
    artifacts: opts.artifacts || [],
    status: 'ready',
    ...git,
    validation: {
      decision: 'passed',
      evidence: opts.evidence || [],
      ...(opts.validatorId ? { validatedBy: opts.validatorId } : {}),
      validatedAt: now
    }
  };
  stores.checkpoints.add(checkpoint);
  emitEvent('checkpoint.created', EVENT_SOURCE, {
    checkpointId: checkpoint.id,
    planId: plan.id,
    runId,
    status: checkpoint.status
  });

  const cycleId = closeCycleOnPass(plan.id, checkpoint.id);
  recordAudit({
    actor: 'validator',
    action: 'checkpoint.create',
    targetType: 'checkpoint',
    targetId: checkpoint.id,
    details: { planId: plan.id, runId, cycleId, status: checkpoint.status }
  });
  return checkpoint;
}

// A passing validation closes the plan's open Cycle (closed-pass), pinning the
// checkpoint id so planId -> runId -> checkpoint lineage stays intact.
export function closeCycleOnPass(planId: string, checkpointId: string): string | undefined {
  const stores = getStores();
  const cycle = stores.cycles.open().find(c => c.planIds.includes(planId));
  if (!cycle) {
    return undefined;
  }
  const now = new Date().toISOString();
  stores.cycles.update(cycle.id, {
    outcome: 'closed-pass',
    closedAt: now,
    checkpointId
  });
  emitEvent('cycle.closed', EVENT_SOURCE, {
    cycleId: cycle.id,
    outcome: 'closed-pass',
    planId,
    checkpointId
  });
  return cycle.id;
}

export interface DeployAuthorizationResult {
  checkpointId: string;
  status: Checkpoint['status'];
  approvalId?: string;
  reason?: string;
}

// Deploy authorization is always human-gated — there is no automatic deploy
// path even if the deploy gate were configured auto elsewhere.
export function requestDeployAuthorization(
  checkpointId: string,
  opts: { requesterId?: string } = {}
): DeployAuthorizationResult {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }
  if (checkpoint.status !== 'ready') {
    return { checkpointId: checkpoint.id, status: checkpoint.status, reason: 'not-ready' };
  }

  const approval = requestApproval({
    type: 'deploy-authorization',
    reason: `Deploy authorization required for checkpoint ${checkpoint.id} (plan ${checkpoint.planId})`,
    requesterId: opts.requesterId,
    target: `checkpoint ${checkpoint.id} for plan ${checkpoint.planId}`,
    pending: {
      op: 'authorize-deploy',
      checkpointId: checkpoint.id,
      planId: checkpoint.planId,
      runId: checkpoint.runId,
      requesterId: opts.requesterId
    }
  });
  stores.checkpoints.update(checkpoint.id, { status: 'deployment-authorizing' });
  return { checkpointId: checkpoint.id, status: 'deployment-authorizing', approvalId: approval.id };
}

// Applies an approved deploy authorization (op 'authorize-deploy'). Requires the
// `plan:deploy` permission of the resolving human actor — never runs caller-less.
export function authorizeDeploy(checkpointId: string, actorId?: string): Checkpoint {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }
  if (!actorId) {
    throw new Error('Deploy authorization requires an explicit human actor');
  }
  const gate = requireEmployeePermission('plan:deploy', actorId);
  if (!gate.ok) {
    throw new Error(gate.error);
  }
  if (checkpoint.status !== 'ready' && checkpoint.status !== 'deployment-authorizing') {
    throw new Error(`Checkpoint ${checkpointId} is not deployable (status=${checkpoint.status})`);
  }

  const now = new Date().toISOString();
  stores.checkpoints.update(checkpoint.id, {
    status: 'deployed',
    deploymentDecision: { by: actorId, at: now }
  });

  recordAudit({
    actor: actorId,
    action: 'deploy.authorize',
    targetType: 'checkpoint',
    targetId: checkpoint.id,
    details: { planId: checkpoint.planId, runId: checkpoint.runId }
  });
  emitEvent('deploy.authorized', EVENT_SOURCE, {
    checkpointId,
    planId: checkpoint.planId,
    by: actorId
  });
  emitEvent('checkpoint.deployed', EVENT_SOURCE, {
    checkpointId,
    planId: checkpoint.planId,
    by: actorId
  });

  return getStores().checkpoints.getById(checkpointId) as Checkpoint;
}

// Backs out an authorization attempt when the deploy approval is rejected —
// the checkpoint stays `ready` (a rejection is not a deploy; the artifact remains).
export function onDeployRejected(checkpointId: string, opts: { by?: string; reason?: string } = {}): Checkpoint {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }
  if (checkpoint.status === 'deployment-authorizing') {
    stores.checkpoints.update(checkpoint.id, { status: 'ready' });
  }
  emitEvent('deploy.rejected', EVENT_SOURCE, {
    checkpointId,
    planId: checkpoint.planId,
    ...(opts.by ? { by: opts.by } : {}),
    ...(opts.reason ? { reason: opts.reason } : {})
  });
  return getStores().checkpoints.getById(checkpointId) as Checkpoint;
}