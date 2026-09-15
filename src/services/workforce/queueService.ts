import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { getStores } from '../../data/stores';
import { AuditEntry, Employee, QueueSettings, Run, RunSummary, Task } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import * as findingsService from './findingsService';
import { updateEmployee } from './workforceService';
import { emitEvent } from './events';
import { gateMode, requestApproval } from './gates';

export type QueueSkipReason =
  | 'task-not-found'
  | 'task-closed'
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
  task: Task;
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

function dataService() {
  return getDataService(fileService.getWorkspaceRoot());
}

function employeeById(id?: string): Employee | undefined {
  if (!id) {return undefined;}
  return getStores().people.getById(id);
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
      target: `run ${run.id} for task ${run.taskId}`,
      pending: { op: 'start-run', runId: run.id, agentId: run.agentId || '' }
    });
    return undefined;
  }

  const now = new Date().toISOString();
  getStores().runs.update(runId, {
    status: 'running',
    availableAt: undefined,
    startedAt: now,
    updatedAt: now
  });

  const employee = employeeById(run.agentId);
  if (employee) {
    updateEmployee(employee.id, { status: 'busy' });
  }

  const ds = dataService();
  const task = ds.getTask(run.taskId);
  if (task) {
    const { agentId } = run;
    ds.updateTask(task.id, {
      workStatus: 'in-progress',
      ...(agentId ? { agent: agentId } : {})
    });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.start',
    targetType: 'task',
    targetId: run.taskId,
    details: { runId: run.id, agentId: run.agentId, taskCode: task?.code }
  });

  emitEvent('run.started', 'queue', {
    runId: run.id,
    taskId: run.taskId,
    taskCode: task?.code,
    agentId: run.agentId
  });

  return getStores().runs.getById(runId);
}

export function createRun(taskId: string, agentIdOrName?: string, opts?: { actor?: string }): Run {
  const ds = dataService();
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) {throw new Error(`Task not found: ${taskId}`);}

  const employees = getStores().people.loadAll();
  const byIdOrName = (id?: string): Employee | undefined =>
    id ? employees.find(e => e.id === id || e.name === id) : undefined;

  const agent = byIdOrName(agentIdOrName) || (task.agent ? byIdOrName(task.agent) : undefined);
  if (!agent) {
    throw new Error(`No agent assigned to task ${task.code}. Assign an agent first via sprintdesk_tasksAssign.`);
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
    taskId: task.id,
    agentId: agent.id,
    status: 'queued',
    attempts: (task.attempts || 0) + 1,
    createdAt: now,
    updatedAt: now
  };

  getStores().runs.add(run);
  ds.updateTask(task.id, { runId: run.id, attempts: run.attempts, agent: agent.id });

  recordAudit({
    actor: opts?.actor || 'queue',
    action: 'run.create',
    targetType: 'task',
    targetId: task.id,
    details: { runId: run.id, agentId: agent.id, agentName: agent.name, taskCode: task.code }
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

  const employee = employeeById(run.agentId);
  if (employee) {
    updateEmployee(employee.id, { status: 'idle' });
  }

  const ds = dataService();
  const task = ds.getTask(run.taskId);
  if (task) {
    ds.updateTask(task.id, {
      workStatus: completed ? 'done' : 'blocked'
    });
  }

  recordAudit({
    actor: 'queue',
    action: 'run.finish',
    targetType: 'task',
    targetId: run.taskId,
    details: {
      runId: run.id,
      agentId: run.agentId,
      status: outcome.status,
      taskCode: task?.code
    }
  });

  emitEvent('run.finished', 'queue', {
    runId: run.id,
    taskId: run.taskId,
    taskCode: task?.code,
    agentId: run.agentId,
    status: outcome.status,
    ...(outcome.classification ? { classification: outcome.classification } : {})
  });

  if (completed) {
    findingsService.materializeFindings(run.id);
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
    targetType: 'task',
    targetId: run.taskId,
    details: { runId, agentId: run.agentId, attempts: run.attempts + 1 }
  });

  emitEvent('run.retried', 'queue', {
    runId,
    taskId: run.taskId,
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

  recordAudit({
    actor: 'queue',
    action: 'run.cancel',
    targetType: 'task',
    targetId: run.taskId,
    details: { runId: run.id, agentId: run.agentId }
  });

  emitEvent('run.cancelled', 'queue', {
    runId: run.id,
    taskId: run.taskId,
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

  const ds = dataService();
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
        taskId: run.taskId,
        reason,
        ...(detail ? { detail } : {})
      });
    };

    if (run.availableAt && run.availableAt > new Date().toISOString()) {
      skip('retry-delay', `available at ${run.availableAt}`);
      continue;
    }

    const task = ds.getTask(run.taskId);
    if (!task) {
      skip('task-not-found');
      continue;
    }
    if (task.status === 'done' || task.status === 'cancelled') {
      skip('task-closed', task.status);
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

    claims.push({ run, task, employee });
    claimedEmployees.add(employee.id);

    if (!dryRun) {
      const startedRun = startRun(run.id);
      if (startedRun) {started.push(startedRun);}
    }
  }

  return { claims, skipped, started };
}