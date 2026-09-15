import { getStores } from '../../data/stores';
import { AuditEntry, Employee, Plan, QueueSettings, Run, RunSummary } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import * as findingsService from './findingsService';
import { updateEmployee } from './workforceService';
import { emitEvent } from './events';
import { gateMode, requestApproval } from './gates';

export type QueueSkipReason =
  | 'plan-not-found'
  | 'plan-not-runnable'
  | 'employee-not-found'
  | 'employee-offline'
  | 'no-permission'
  | 'not-agent'
  | 'concurrency-limit'
  | 'not-assigned'
  | 'retry-delay';

export interface QueueSkip {
  runId: string;
  reason: QueueSkipReason;
  detail?: string;
}

export interface QueueClaim {
  run: Run;
  plan: Plan;
  employee: Employee;
}

export interface QueueProcessOptions {
  limit?: number;
  dryRun?: boolean;
}

export interface QueueProcessResult {
  claims: QueueClaim[];
  skipped: QueueSkip[];
  started: Run[];
}

export interface RunOutcome {
  status: 'completed' | 'failed';
  result?: string;
  error?: string;
  classification?: RunFailureClassification;
}

export type RunFailureClassification =
  | 'exit-nonzero'
  | 'timeout'
  | 'spawn-error'
  | 'invalid-config'
  | 'none';

const NON_RETRYABLE_CLASSIFICATIONS: ReadonlySet<RunFailureClassification> = new Set([
  'spawn-error',
  'invalid-config'
]);

export function isRetryableClassification(classification?: RunFailureClassification): boolean {
  if (classification === undefined) {return true;}
  return !NON_RETRYABLE_CLASSIFICATIONS.has(classification);
}

export function computeRetryDelayMs(attempts: number, baseBackoffMs: number): number {
  return baseBackoffMs * attempts;
}

const SUMMARY_HEADER = /^\s*(findings|errors|summary|notes|references|conclusion|analysis)[:.\-]?\s*$/i;
const BULLET_LINE = /^\s*[-*•]|\s*\d+[.)]\s/;
const ERROR_LINE = /\b(error|exception|failed|failure|timeout|unreachable|spawn-error)\b/i;
const ZERO_LINE = /^[\s\-*.]*(0|none|null)$/i;

function countSectionItems(lines: string[]): number {
  const bullets = lines.filter(l => BULLET_LINE.test(l));
  if (bullets.length > 0) {return bullets.length;}
  return lines.filter(l => !SUMMARY_HEADER.test(l)).length;
}

export function summarizeRunOutput(output?: string, error?: string, failed = false): RunSummary {
  const lines = (output || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { findings: 0, errors: failed && error ? 1 : 0 };
  }

  const findingsIdx = lines.findIndex(l => /^findings:?\s*$/i.test(l));
  const errorsIdx = lines.findIndex(l => /^errors:?\s*$/i.test(l));

  let findings = 0;
  if (findingsIdx !== -1) {
    const sectionEnd = errorsIdx > findingsIdx ? errorsIdx : lines.length;
    findings = countSectionItems(lines.slice(findingsIdx + 1, sectionEnd));
  } else {
    const bullets = lines.filter(l => BULLET_LINE.test(l) && !ERROR_LINE.test(l));
    const meaningful = lines.filter(l => !BULLET_LINE.test(l) && !ERROR_LINE.test(l) && !SUMMARY_HEADER.test(l));
    findings = bullets.length > 0 ? bullets.length : meaningful.length;
  }

  let errors = 0;
  if (errorsIdx !== -1) {
    const section = lines.slice(errorsIdx + 1).filter(l => !SUMMARY_HEADER.test(l));
    const items = section.filter(l => !ZERO_LINE.test(l));
    errors = items.length > 0 ? countSectionItems(items) : 0;
  } else {
    errors = lines.filter(l => ERROR_LINE.test(l)).length;
  }

  if (failed && error) {errors += 1;}
  return { findings, errors };
}

function employeeById(id?: string): Employee | undefined {
  if (!id) {return undefined;}
  return getStores().people.getById(id);
}

function planById(id: string): Plan | undefined {
  return getStores().plans.getById(id);
}

// A plan is queued-runnable unless scheduling is terminal (done/failed/cancelled/blocked)
// or execution has already completed/failed. Draft/ready plans with queued runs claim.
function isQueueRunnablePlan(plan: Plan): boolean {
  if (plan.execution.status === 'completed' || plan.execution.status === 'failed') {
    return false;
  }
  const status = plan.scheduling.status;
  return status !== 'done' && status !== 'failed' && status !== 'cancelled' && status !== 'blocked';
}

function runningRuns(): Run[] {
  return getStores().runs.loadAll().filter(r => r.status === 'running');
}

function rankQueuedRuns(runs: Run[]): Run[] {
  return runs
    .filter(r => r.status === 'queued')
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {return a.createdAt < b.createdAt ? -1 : 1;}
      if (a.attempts !== b.attempts) {return a.attempts - b.attempts;}
      return a.id < b.id ? -1 : 1;
    });
}

function recordAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString()
  });
}

export function getQueueSettings(): QueueSettings {
  return getStores().queue.getSettings();
}

export function updateQueueSettings(settings: Partial<QueueSettings>): QueueSettings {
  return getStores().queue.saveSettings(settings);
}

export function startRun(runId: string, opts?: { bypassGate?: boolean }): Run | undefined {
  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'queued') {return undefined;}

  if (!opts?.bypassGate && gateMode('run-execution') === 'manual') {
    requestApproval({
      type: 'run-execution',
      reason: 'Run execution requires manual approval',
      requesterId: run.agentId,
      target: `run ${run.id} for plan ${run.planId}`,
      pending: { op: 'start-run', runId: run.id, agentId: run.agentId || '' }
    });
    return undefined;
  }

  const plan = planById(run.planId);
  const now = new Date().toISOString();
  getStores().runs.update(runId, {
    status: 'running',
    availableAt: undefined,
    startedAt: now,
    updatedAt: now
  });

  if (plan) {
    getStores().plans.update(plan.id, {
      execution: { ...plan.execution, status: 'running', runId: run.id },
      updatedAt: now
    });
  }

  const employee = employeeById(run.agentId);
  if (employee) {
    updateEmployee(employee.id, { status: 'busy' });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.start',
    targetType: 'plan',
    targetId: run.planId,
    details: { runId: run.id, agentId: run.agentId, planCode: plan?.id }
  });

  emitEvent('run.started', 'queue', {
    runId: run.id,
    planId: run.planId,
    planCode: plan?.id,
    agentId: run.agentId
  });

  return getStores().runs.getById(runId);
}

export function createRun(planId: string, agentIdOrName?: string, opts?: { actor?: string }): Run {
  const plan = getStores().plans.getById(planId);
  if (!plan) {throw new Error(`Plan not found: ${planId}`);}

  const employees = getStores().people.loadAll();
  const byIdOrName = (id?: string): Employee | undefined =>
    id ? employees.find(e => e.id === id || e.name === id) : undefined;

  const agent =
    byIdOrName(agentIdOrName) ||
    (plan.execution.assignedAgent ? byIdOrName(plan.execution.assignedAgent) : undefined);
  if (!agent) {
    throw new Error(`No agent assigned to plan ${plan.id}. Assign an agent first.`);
  }

  const gate = requireEmployeePermission('run:create', agent.id);
  if (!gate.ok) {throw new Error(gate.error);}

  if (agent.role !== 'agent') {
    throw new Error(`Only agent records can start workforce runs. ${agent.name} is a ${agent.role}.`);
  }

  if (agent.status === 'offline') {
    throw new Error(`Agent ${agent.name} is offline and cannot take work`);
  }

  const now = new Date().toISOString();
  const run: Run = {
    id: `run_${Date.now()}`,
    planId: plan.id,
    agentId: agent.id,
    status: 'queued',
    attempts: getStores().runs.findByPlanId(plan.id).length + 1,
    createdAt: now,
    updatedAt: now
  };

  getStores().runs.add(run);
  getStores().plans.update(plan.id, {
    execution: {
      ...plan.execution,
      status: 'assigned',
      assignedAgent: agent.id,
      runId: run.id
    },
    updatedAt: now
  });

  recordAudit({
    actor: opts?.actor || 'queue',
    action: 'run.create',
    targetType: 'plan',
    targetId: plan.id,
    details: { runId: run.id, agentId: agent.id, agentName: agent.name, planCode: plan.id }
  });

  return run;
}

export function finishRun(runId: string, outcome: RunOutcome): Run | undefined {
  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return undefined;}

  const completed = outcome.status === 'completed';
  const now = new Date().toISOString();
  const summary = summarizeRunOutput(outcome.result, outcome.error, !completed);
  getStores().runs.update(runId, {
    status: outcome.status,
    finishedAt: now,
    result: outcome.result,
    error: outcome.error,
    summary,
    updatedAt: now
  });

  const plan = planById(run.planId);
  if (plan) {
    getStores().plans.update(plan.id, {
      execution: { ...plan.execution, status: completed ? 'completed' : 'failed' },
      updatedAt: now
    });
  }

  const employee = employeeById(run.agentId);
  if (employee) {
    updateEmployee(employee.id, { status: 'idle' });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.finish',
    targetType: 'plan',
    targetId: run.planId,
    details: {
      runId: run.id,
      agentId: run.agentId,
      status: outcome.status,
      planCode: plan?.id
    }
  });

  emitEvent('run.finished', 'queue', {
    runId: run.id,
    planId: run.planId,
    planCode: plan?.id,
    agentId: run.agentId,
    status: outcome.status,
    ...(outcome.classification ? { classification: outcome.classification } : {})
  });

  if (completed) {
    findingsService.materializeFindings(run.id);
  }

  // v1.0 Slice E — execution-outcome events (completion/failure) mirror the
  // run.finished signal for consumers that do not want to parse run status.
  if (completed) {
    emitEvent('execution.completed', 'queue', {
      runId: run.id,
      planId: run.planId,
      planCode: plan?.id,
      agentId: run.agentId
    });
  } else {
    emitEvent('plan.failed', 'queue', {
      runId: run.id,
      planId: run.planId,
      planCode: plan?.id,
      agentId: run.agentId,
      ...(outcome.classification ? { classification: outcome.classification } : {})
    });
  }

  return getStores().runs.getById(runId);
}

export function requeueRun(runId: string, opts?: { classification?: RunFailureClassification }): boolean {
  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return false;}

  const classification = opts?.classification;
  if (!isRetryableClassification(classification)) {return false;}
  const settings = getQueueSettings();
  if (run.attempts > settings.maxRunRetries) {return false;}

  const now = new Date().toISOString();
  const delayMs = computeRetryDelayMs(run.attempts, settings.retryBackoffMs);
  getStores().runs.update(runId, {
    status: 'queued',
    attempts: run.attempts + 1,
    availableAt: delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : undefined,
    startedAt: undefined,
    finishedAt: undefined,
    result: undefined,
    error: undefined,
    updatedAt: now
  });

  const employee = employeeById(run.agentId);
  if (employee) {
    updateEmployee(employee.id, { status: 'idle' });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.retry',
    targetType: 'plan',
    targetId: run.planId,
    details: { runId, agentId: run.agentId, attempts: run.attempts + 1 }
  });

  emitEvent('run.retried', 'queue', {
    runId,
    planId: run.planId,
    agentId: run.agentId,
    attempts: run.attempts + 1
  });

  return true;
}

export function cancelRun(runId: string, actorId?: string): Run | undefined {
  const run = getStores().runs.getById(runId);
  if (!run) {return undefined;}
  if (run.status !== 'queued' && run.status !== 'running') {return undefined;}

  const gate = requireEmployeePermission('run:cancel', actorId || run.agentId);
  if (!gate.ok) {
    throw new Error(gate.error);
  }

  const wasRunning = run.status === 'running';
  const now = new Date().toISOString();
  getStores().runs.update(runId, {
    status: 'cancelled',
    finishedAt: now,
    updatedAt: now
  });

  if (wasRunning) {
    const employee = employeeById(run.agentId);
    if (employee) {
      updateEmployee(employee.id, { status: 'idle' });
    }
  }

  const plan = planById(run.planId);
  if (plan) {
    getStores().plans.update(plan.id, {
      execution: { ...plan.execution, status: 'unassigned', runId: undefined },
      updatedAt: now
    });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.cancel',
    targetType: 'plan',
    targetId: run.planId,
    details: { runId: run.id, agentId: run.agentId, planCode: plan?.id }
  });

  emitEvent('run.cancelled', 'queue', {
    runId: run.id,
    planId: run.planId,
    planCode: plan?.id,
    agentId: run.agentId
  });

  return getStores().runs.getById(runId);
}

export function processQueue(options: QueueProcessOptions = {}): QueueProcessResult {
  const settings = getQueueSettings();
  const dryRun = options.dryRun !== false;
  const available =
    options.limit === undefined
      ? settings.maxConcurrentRuns
      : Math.min(options.limit, settings.maxConcurrentRuns);

  const activeRunning = runningRuns();
  const baselineRunning = activeRunning.length;
  const claimsBudget = Math.max(0, available - baselineRunning);
  const runningEmployees = new Set(
    activeRunning.map(r => r.agentId).filter((id): id is string => Boolean(id))
  );

  const claims: QueueClaim[] = [];
  const skipped: QueueSkip[] = [];
  const claimedEmployees = new Set<string>();
  const started: Run[] = [];

  for (const run of rankQueuedRuns(getStores().runs.loadAll())) {
    const skip = (reason: QueueSkipReason, detail?: string): void => {
      skipped.push({ runId: run.id, reason, detail });
      emitEvent('queue.skip', 'queue', {
        runId: run.id,
        planId: run.planId,
        reason,
        ...(detail ? { detail } : {})
      });
    };

    if (run.availableAt && run.availableAt > new Date().toISOString()) {
      skip('retry-delay', `available at ${run.availableAt}`);
      continue;
    }

    const plan = planById(run.planId);
    if (!plan) {
      skip('plan-not-found');
      continue;
    }
    if (!isQueueRunnablePlan(plan)) {
      skip('plan-not-runnable', `scheduling=${plan.scheduling.status} execution=${plan.execution.status}`);
      continue;
    }

    const employee = employeeById(run.agentId);
    if (!employee) {
      skip('employee-not-found');
      continue;
    }
    if (employee.status === 'offline') {
      skip('employee-offline');
      continue;
    }

    const gate = requireEmployeePermission('run:create', employee.id);
    if (!gate.ok) {
      skip('no-permission', gate.error);
      continue;
    }

    if (employee.role !== 'agent') {
      skip('not-agent', `${employee.name} is ${employee.role}, only agents can start runs`);
      continue;
    }

    if (runningEmployees.has(employee.id) || claimedEmployees.has(employee.id)) {
      skip('concurrency-limit', `${employee.name} is already busy or claimed`);
      continue;
    }

    if (claims.length >= claimsBudget) {
      skip('concurrency-limit', 'global capacity reached');
      continue;
    }

    claims.push({ run, plan, employee });
    claimedEmployees.add(employee.id);

    if (!dryRun) {
      const startedRun = startRun(run.id);
      if (startedRun) {started.push(startedRun);}
    }
  }

  return { claims, skipped, started };
}