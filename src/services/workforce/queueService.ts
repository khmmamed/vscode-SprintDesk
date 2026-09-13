import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { getStores } from '../../data/stores';
import { AuditEntry, Employee, QueueSettings, Run, Task } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import { updateEmployee } from './workforceService';
import { emitEvent } from './events';
import { gateMode, requestApproval } from './gates';

export type QueueSkipReason =
  | 'task-not-found'
  | 'task-closed'
  | 'employee-not-found'
  | 'employee-offline'
  | 'no-permission'
  | 'concurrency-limit'
  | 'not-assigned';

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

function dataService() {
  return getDataService(fileService.getWorkspaceRoot());
}

function employeeById(id?: string): Employee | undefined {
  if (!id) {return undefined;}
  return getStores().employees.getById(id);
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

export function finishRun(runId: string, outcome: RunOutcome): Run | undefined {
  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return undefined;}

  const completed = outcome.status === 'completed';
  const now = new Date().toISOString();
  getStores().runs.update(runId, {
    status: outcome.status,
    finishedAt: now,
    result: outcome.result,
    error: outcome.error,
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

  return getStores().runs.getById(runId);
}

export function requeueRun(runId: string): boolean {
  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return false;}
  const settings = getQueueSettings();
  if (run.attempts > settings.maxRunRetries) {return false;}

  const now = new Date().toISOString();
  getStores().runs.update(runId, {
    status: 'queued',
    attempts: run.attempts + 1,
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