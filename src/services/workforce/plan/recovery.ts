import * as path from 'path';
import { getStores } from '../../../data/stores';
import { EventRecord, InputRecord, Plan, Run } from '../../../data/types';
import { getFileSystem } from '../../../host';
import { getWorkspaceRoot } from '../../fileService';
import { emitEvent, subscribeEvents } from '../events';
import {
  computeRetryDelayMs,
  getQueueSettings,
  isRetryableClassification,
  RunFailureClassification
} from '../queueService';
import { ingestInput } from '../orchestrator';
import { readPlanMd, resolvePlanFile } from './planService';

const EVENT_SOURCE = 'recovery';

// v1.0 Slice G — Recovery. On `plan.failed` (or validator failed/revision) the
// failure is classified and escalated into exactly one outcome:
//   - requeue: retry-eligible execution failure, re-queued with backoff (same run),
//   - replan: a fresh `inputs/*.md` + InputRecord for a new lifecycle round.
// The Organizer never writes content; recovery writes the replan input artifact
// directly from the failed plan's objective (re-decomposition input only).
// Idempotence: a run is recovered at most once (run status + persisted replan
// InputRecord keyed by `source.id === runId`).

export type RecoveryDecision = 'none' | 'requeue' | 'replan';
export type FailureClassification = 'retryable' | 'non-retryable';

export interface RecoveryOutcome {
  planId: string;
  runId: string;
  decision: RecoveryDecision;
  attempt?: number;
  availableAt?: string;
  inputId?: string;
  inputFile?: string;
  cycleId?: string;
  reason?: string;
}

export interface RecoverFailureInput {
  planId: string;
  runId: string;
  classification?: RunFailureClassification;
  decision?: 'auto' | 'replan';
  reason?: string;
}

export function classifyFailure(classification?: RunFailureClassification): FailureClassification {
  return isRetryableClassification(classification) ? 'retryable' : 'non-retryable';
}

// Retry-eligible failures requeue while they remain inside the retry policy;
// exhausted or non-retryable failures escalate to replanning.
export function decideRecovery(run: Run, classification?: RunFailureClassification): RecoveryDecision {
  if (run.status !== 'failed') {
    return 'none';
  }
  if (classifyFailure(classification) === 'retryable' && run.attempts <= getQueueSettings().maxRunRetries) {
    return 'requeue';
  }
  return 'replan';
}

function recordAudit(entry: { actor: string; action: string; targetType: string; targetId: string; details?: Record<string, unknown> }): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString()
  } as any);
}

function replanInputName(runId: string): string {
  return `replan-${runId}.md`;
}

function titleOf(plan: Plan): string {
  return plan.id;
}

function planObjective(plan: Plan, root: string): { objective: string; implementation: string } {
  try {
    const file = path.join(root, '.SprintDesk', resolvePlanFile(plan));
    if (getFileSystem().exists(file)) {
      const { sections } = readPlanMd(file);
      return {
        objective: sections.objective || titleOf(plan),
        implementation: sections.implementation || ''
      };
    }
  } catch {
    // unreadable artifact — fall through to id-based fallback
  }
  return { objective: titleOf(plan), implementation: '' };
}

// A replan request is an input artifact, never a plan write. The Organizer will
// re-decompose it on the next pass under its own cap.
function writeReplanInput(plan: Plan, run: Run, classification: RunFailureClassification | undefined, root: string): InputRecord {
  const dir = path.join(root, '.SprintDesk', 'inputs');
  getFileSystem().mkdir(dir, { recursive: true });
  const file = path.join(dir, replanInputName(run.id));
  const { objective, implementation } = planObjective(plan, root);
  const reason = classification || 'validation-failure';
  const content = [
    '---',
    `title: Replan: ${objective}`,
    `objective: ${objective}`,
    'category: maintenance',
    `source: replan`,
    `reason: ${reason}`,
    '---',
    '',
    `Requested replan of ${plan.id} (run ${run.id}) after a ${reason}. `,
    'The original objective is preserved for re-decomposition.',
    '',
    implementation
  ].join('\n');
  getFileSystem().writeFile(file, content);
  return ingestInput(file, {
    workspaceRoot: root,
    source: { type: 'agent', id: run.id }
  });
}

function requeueFailedRun(plan: Plan, run: Run, classification: RunFailureClassification | undefined): Pick<RecoveryOutcome, 'attempt' | 'availableAt'> {
  const stores = getStores();
  const settings = getQueueSettings();
  const now = new Date().toISOString();
  const attempt = run.attempts + 1;
  const delayMs = computeRetryDelayMs(run.attempts, settings.retryBackoffMs);
  const availableAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : undefined;

  stores.runs.update(run.id, {
    status: 'queued',
    attempts: attempt,
    availableAt,
    startedAt: undefined,
    finishedAt: undefined,
    updatedAt: now
  });
  // The queue will only re-claim a plan that is not terminal — flip the failed
  // execution back to assigned so the retry run is the same run, with backoff.
  stores.plans.update(plan.id, {
    execution: { ...plan.execution, status: 'assigned', runId: run.id },
    updatedAt: now
  });

  recordAudit({
    actor: 'recovery',
    action: 'plan.requeue',
    targetType: 'plan',
    targetId: plan.id,
    details: { runId: run.id, classification: classification || 'none', attempt }
  });

  emitEvent('run.retried', EVENT_SOURCE, {
    runId: run.id,
    planId: plan.id,
    agentId: run.agentId,
    attempts: attempt
  });
  emitEvent('plan.requeued', EVENT_SOURCE, {
    planId: plan.id,
    runId: run.id,
    attempts: attempt,
    ...(availableAt ? { availableAt } : {})
  });

  return { attempt, availableAt };
}

// Escalation closes the plan's open lifecycle cycle with a failure outcome.
function escalateCycle(plan: Plan, reason: string): string | undefined {
  const stores = getStores();
  const cycle = stores.cycles.open().find(c => c.planIds.includes(plan.id));
  if (!cycle) {
    return undefined;
  }
  const now = new Date().toISOString();
  stores.cycles.update(cycle.id, { outcome: 'closed-fail', closedAt: now });
  emitEvent('cycle.closed', EVENT_SOURCE, {
    cycleId: cycle.id,
    outcome: 'closed-fail',
    planId: plan.id,
    reason
  });
  return cycle.id;
}

export function recoverFailure(request: RecoverFailureInput): RecoveryOutcome {
  const base = { planId: request.planId, runId: request.runId };
  const stores = getStores();
  const plan = stores.plans.getById(request.planId);
  if (!plan) {
    return { ...base, decision: 'none', reason: 'plan-not-found' };
  }
  const run = stores.runs.getById(request.runId);
  if (!run) {
    return { ...base, decision: 'none', reason: 'run-not-found' };
  }

  const decision: RecoveryDecision = request.decision === 'replan' ? 'replan' : decideRecovery(run, request.classification);
  if (decision === 'none') {
    return { ...base, decision: 'none', reason: 'not-recoverable' };
  }

  // Idempotence — a replan input keyed by source.id === runId must exist at most once.
  const existingReplan = stores.inputs
    .loadAll()
    .find(i => i.source?.type === 'agent' && i.source.id === run.id && i.status === 'new');
  if (existingReplan) {
    return {
      ...base,
      decision: 'none',
      reason: 'already-replanned',
      inputId: existingReplan.id,
      inputFile: existingReplan.file,
      cycleId: stores.cycles.byPlanId(plan.id)[0]?.id
    };
  }

  const escalated = decision === 'replan';
  const reason = request.reason || (escalated ? 'execution-failure-escalated' : 'execution-failure-retryable');
  emitEvent('plan.failure.classified', EVENT_SOURCE, {
    planId: plan.id,
    runId: run.id,
    classification: request.classification || 'none',
    decision,
    escalated,
    reason
  });

  if (decision === 'requeue') {
    const outcome = requeueFailedRun(plan, run, request.classification);
    return { ...base, decision, ...outcome, reason };
  }

  // Replan: close the failed cycle, then mint the new input artifact + record.
  const cycleId = escalateCycle(plan, reason);
  const root = getWorkspaceRoot();
  const input = writeReplanInput(plan, run, request.classification, root);
  recordAudit({
    actor: 'recovery',
    action: 'plan.replan',
    targetType: 'plan',
    targetId: plan.id,
    details: { runId: run.id, inputId: input.id, inputFile: input.file, cycleId }
  });
  emitEvent('plan.replanning.requested', EVENT_SOURCE, {
    planId: plan.id,
    runId: run.id,
    inputId: input.id,
    inputFile: input.file
  });

  return {
    ...base,
    decision,
    inputId: input.id,
    inputFile: input.file,
    cycleId,
    reason
  };
}

// ---------------------------------------------------------------------------
// Wiring — recovery drives off the execution-failure signal. The decisions it
// translates are data, mirroring the Dispatcher's decision-intake contract.
// ---------------------------------------------------------------------------

let installed = false;

export function installRecovery(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;
  const unsubscribe = subscribeEvents((event: EventRecord) => {
    if (event.type !== 'plan.failed') {
      return;
    }
    const planId = typeof event.payload?.planId === 'string' ? event.payload.planId : undefined;
    const runId = typeof event.payload?.runId === 'string' ? event.payload.runId : undefined;
    if (!planId || !runId) {
      return;
    }
    const classification = typeof event.payload?.classification === 'string'
      ? (event.payload.classification as RunFailureClassification)
      : undefined;
    recoverFailure({ planId, runId, classification, reason: 'plan.failed' });
  });
  return () => {
    unsubscribe();
    installed = false;
  };
}