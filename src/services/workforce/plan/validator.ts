import { getStores } from '../../../data/stores';
import { EventRecord, PlanValidationDecision, Run } from '../../../data/types';
import { emitEvent, subscribeEvents } from '../events';
import {
  DeployAuthorizationResult,
  requestDeployAuthorization,
  recordValidation,
  ValidationRecord
} from './checkpointService';

const EVENT_SOURCE = 'validator';

// v1.0 Slice J — the Validator stage of the runtime lifecycle. It closes the
// gap between a finished execution and checkpointService without becoming a
// second source of truth:
//
//   execution.completed
//     -> deriveValidationRecord(run)          (existing run summary; no new store)
//     -> checkpointService.recordValidation
//          passed          -> checkpointService.createCheckpoint  (ready)
//          failed/revision -> recovery.recoverFailure             (Slice G path)
//
//   checkpoint.created
//     -> checkpointService.requestDeployAuthorization           (manual human gate)
//
// checkpointService owns every checkpoint/deploy transition; the Validator only
// calls its public functions. The Dispatcher is untouched and stays execution-only.
// Only these two event types are observed, so unrelated workforce events cannot
// create checkpoints.
//
// Idempotence: the plan's `validation.runId` marker is set by recordValidation, so
// a duplicate `execution.completed` for the same run is a no-op. A deploy
// authorization is only requested once per checkpoint (an existing
// `authorize-deploy` approval short-circuits a re-request).

export interface ValidationOutcome {
  planId: string;
  runId: string;
  decision: PlanValidationDecision | 'skipped';
  reason?: string;
  checkpointId?: string;
}

// Deterministic decision from the run's existing structured summary — the same
// summary the Dispatcher/Worker already produce and that feeds finding
// materialization. No parallel validation system is introduced.
export function deriveValidationRecord(run: Run): ValidationRecord {
  const errors = run.summary?.errors || 0;
  if (errors > 0) {
    return {
      decision: 'revision',
      errors: [`completed run reported ${errors} error(s); revision required`]
    };
  }
  return {
    decision: 'passed',
    artifacts: [],
    evidence: [`run ${run.id} completed with no reported errors`]
  };
}

// The validator trigger. Safe to call from events or directly; every early exit
// is a no-op that reports why, so callers never observe a partial transition.
export function validateCompletedRun(runId: string, planIdHint?: string): ValidationOutcome {
  const stores = getStores();
  const run = stores.runs.getById(runId);
  if (!run) {
    return { planId: planIdHint || '', runId, decision: 'skipped', reason: 'run-not-found' };
  }
  if (run.status !== 'completed') {
    return { planId: run.planId, runId, decision: 'skipped', reason: 'run-not-completed' };
  }

  const planId = planIdHint || run.planId;
  const plan = stores.plans.getById(planId);
  if (!plan) {
    return { planId, runId, decision: 'skipped', reason: 'plan-not-found' };
  }
  if (plan.validation?.runId === runId) {
    return { planId, runId, decision: 'skipped', reason: 'already-validated' };
  }

  // Belt and braces: an existing checkpoint for this plan/run already proves the
  // validation ran, even if the plan marker was lost to an external edit.
  const existingCheckpoint = stores.checkpoints.byPlanId(planId).find(c => c.runId === runId);
  if (existingCheckpoint) {
    return {
      planId,
      runId,
      decision: 'skipped',
      reason: 'checkpoint-exists',
      checkpointId: existingCheckpoint.id
    };
  }

  const record = deriveValidationRecord(run);
  recordValidation(planId, record);
  const checkpoint = stores.checkpoints.byPlanId(planId).find(c => c.runId === runId);
  return { planId, runId, decision: record.decision, checkpointId: checkpoint?.id };
}

// Requests the human deploy authorization for a freshly created checkpoint.
// Idempotent: an existing `authorize-deploy` approval (pending, approved or
// rejected) suppresses a duplicate request, keeping a rejected checkpoint at
// `ready` instead of bouncing it back to `deployment-authorizing`.
export function requestDeployForCheckpoint(checkpointId: string): DeployAuthorizationResult {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(checkpointId);
  if (!checkpoint) {
    return { checkpointId, status: 'ready', reason: 'checkpoint-not-found' };
  }
  const existing = stores.approvals
    .loadAll()
    .find(a => a.pending?.op === 'authorize-deploy' && a.pending.checkpointId === checkpointId);
  if (existing) {
    return {
      checkpointId,
      status: checkpoint.status,
      approvalId: existing.id,
      reason: 'authorization-exists'
    };
  }
  if (checkpoint.status !== 'ready') {
    return { checkpointId, status: checkpoint.status, reason: 'not-ready' };
  }
  return requestDeployAuthorization(checkpointId);
}

let installed = false;

// Wires the Validator into the workforce event stream (extension activation).
export function installValidator(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;

  const unsubscribe = subscribeEvents((event: EventRecord) => {
    try {
      if (event.type === 'execution.completed') {
        const runId = payloadString(event, 'runId');
        if (runId) {
          validateCompletedRun(runId, payloadString(event, 'planId'));
        }
      } else if (event.type === 'checkpoint.created') {
        const checkpointId = payloadString(event, 'checkpointId');
        if (checkpointId) {
          requestDeployForCheckpoint(checkpointId);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      emitEvent('validator.skipped', EVENT_SOURCE, { eventType: event.type, reason });
    }
  });

  return () => {
    unsubscribe();
    installed = false;
  };
}

function payloadString(event: EventRecord, key: string): string | undefined {
  const value = event.payload?.[key];
  return typeof value === 'string' && value ? value : undefined;
}
