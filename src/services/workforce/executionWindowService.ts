import { getStores } from '../../data/stores';
import { getDataService } from '../../data/DataService';
import { ExecutionWindow, ExecutionWindowCompletionSummary, WorkerMode } from '../../data/types';
import { emitEvent, subscribeEvents } from './events';
import { runQueuePass } from './worker/worker';
import { executeWorkflow } from './workflow/engine';
import * as queueService from './queueService';
import { hasEmployeePermission, requireEmployeePermission } from './capabilityService';
import { getExecutionWindowReport } from './observability';

// v0.11 slice 7 — Execution Windows: a persistent, synchronous batch/session of autonomous work.
// Sync: Human → Execution Window → Workflow → Task/Run → Queue → Worker → Finding → Review → Decision.
// Async (unchanged): Schedule → Workflow → Run and Event Rule → Workflow → Run.

export interface CreateExecutionWindowInput {
  name: string;
  goal?: string;
  workflowIds: string[];
  agentIds?: string[];
  workerMode?: WorkerMode;
  maxConcurrentRuns?: number;
  scheduledStartAt?: string;
  createdBy?: string;
}

let autoAdvanceEnabled = true;

export function setAutoAdvanceEnabled(enabled: boolean): void {
  autoAdvanceEnabled = enabled;
}

function nowIso(): string {
  return new Date().toISOString();
}

function recordAudit(entry: { actor: string; action: string; targetType: string; targetId: string; details?: Record<string, unknown> }): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: nowIso()
  });
}

export function getExecutionWindows(): ExecutionWindow[] {
  return getStores().executionWindows.loadAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getExecutionWindowById(windowId: string): ExecutionWindow | undefined {
  return getStores().executionWindows.getById(windowId);
}

export function createExecutionWindow(input: CreateExecutionWindowInput): ExecutionWindow {
  const name = String(input.name || '').trim();
  if (!name) {throw new Error('Execution window name is required');}
  const workflowIds = (input.workflowIds || []).filter(Boolean);
  if (workflowIds.length === 0) {throw new Error('Select at least one workflow');}

  const id = `execwindow_${Date.now()}`;
  const now = nowIso();
  const window: ExecutionWindow = {
    id,
    name,
    goal: input.goal?.trim() || undefined,
    status: 'planned',
    workflowIds,
    agentIds: (input.agentIds || []).filter(Boolean),
    workerMode: input.workerMode,
    maxConcurrentRuns: input.maxConcurrentRuns,
    scheduledStartAt: input.scheduledStartAt,
    taskIds: [],
    runIds: [],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };
  getStores().executionWindows.add(window);
  recordAudit({ actor: input.createdBy || 'control-center', action: 'execwindow.create', targetType: 'executionWindow', targetId: id });
  emitEvent('execwindow.created', 'execwindow', { windowId: id, name, workflowIds });
  return window;
}

function collectTasksFromWorkflow(taskIds: string[], results: { stepResults: { outputs: Record<string, unknown> }[] }): string[] {
  for (const step of results.stepResults) {
    if (typeof step.outputs?.taskId === 'string' && !taskIds.includes(step.outputs.taskId)) {
      taskIds.push(step.outputs.taskId);
    }
  }
  return taskIds;
}

function runForTask(taskId: string): string | undefined {
  const stores = getStores();
  const ds = getDataService();
  const task = ds.getTask(taskId);
  if (task?.runId) {return task.runId;}
  return stores.runs.findByTaskId(taskId).map(r => r.id).pop();
}

function assignAgents(window: ExecutionWindow, runIds: string[]): void {
  const stores = getStores();
  const employees = stores.people.loadAll();
  const pool = (window.agentIds.length > 0
    ? employees.filter(e => window.agentIds.includes(e.id))
    : employees.filter(e => e.role === 'agent'))
    .filter(e => e.status !== 'offline' && hasEmployeePermission(e, 'run:create'))
    .sort((a, b) => (a.status === b.status ? (a.name < b.name ? -1 : 1) : a.status === 'idle' ? -1 : 1));

  if (pool.length === 0) {return;}

  const createdRuns = runIds.map(id => stores.runs.getById(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const unassigned = createdRuns.filter(r => !r.agentId);
  unassigned.forEach((run, index) => {
    const agent = pool[index % pool.length];
    stores.runs.update(run.id, { agentId: agent.id, updatedAt: nowIso() });
    const ds = getDataService();
    const task = ds.getTask(run.taskId);
    if (task) {ds.updateTask(task.id, { agent: agent.id });}
  });
}

function finalizeWindow(window: ExecutionWindow): void {
  const report = getExecutionWindowReport(window);
  const stores = getStores();
  const errors = window.runIds.reduce((sum, id) => sum + (stores.runs.getById(id)?.summary?.errors || 0), 0);
  const summary: ExecutionWindowCompletionSummary = {
    runsCompleted: report.runs.completed,
    runsFailed: report.runs.failed,
    runsCancelled: report.runs.cancelled,
    findings: report.findings.total,
    errors
  };
  const now = nowIso();
  stores.executionWindows.update(window.id, {
    status: 'completed',
    finishedAt: now,
    completionSummary: summary,
    updatedAt: now
  });
  recordAudit({ actor: 'execwindow', action: 'execwindow.complete', targetType: 'executionWindow', targetId: window.id, details: { ...summary } as Record<string, unknown> });
  emitEvent('execwindow.completed', 'execwindow', {
    windowId: window.id,
    name: window.name,
    runCount: report.runCount,
    runs: report.runs,
    findings: report.findings,
    errors
  });
}

async function runWindowPass(window: ExecutionWindow): Promise<void> {
  if (window.status !== 'running') {return;}
  await runQueuePass({ mode: window.workerMode, limit: window.maxConcurrentRuns });
}

let queuePassActive = false;

async function kickWindowPass(window: ExecutionWindow): Promise<void> {
  if (!autoAdvanceEnabled) {return;}
  if (queuePassActive) {return;}
  queuePassActive = true;
  try {
    await runWindowPass(window);
  } finally {
    queuePassActive = false;
  }
}

const WINDOW_RUN_EVENTS = new Set(['run.finished', 'run.cancelled', 'run.retried', 'run.queued']);

function isAllRunsTerminal(window: ExecutionWindow): boolean {
  const stores = getStores();
  if (window.runIds.length === 0) {return false;}
  return window.runIds.every(id => {
    const run = stores.runs.getById(id);
    return !!run && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled');
  });
}

subscribeEvents(event => {
  if (!WINDOW_RUN_EVENTS.has(event.type)) {return;}
  const runId = typeof event.payload?.runId === 'string' ? event.payload.runId : undefined;
  if (!runId) {return;}
  const win = getExecutionWindows().find(w => w.status === 'running' && w.runIds.includes(runId));
  if (!win) {return;}
  if (isAllRunsTerminal(win)) {
    finalizeWindow(win);
  } else {
    void kickWindowPass(win);
  }
});

export async function startExecutionWindow(windowId: string, actorId?: string): Promise<ExecutionWindow> {
  const stores = getStores();
  const window = stores.executionWindows.getById(windowId);
  if (!window) {throw new Error(`Execution window not found: ${windowId}`);}
  if (window.status !== 'planned') {throw new Error(`Execution window ${window.id} is already ${window.status}`);}

  const gate = requireEmployeePermission('run:create', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const ds = getDataService();
  const runIds: string[] = [];
  const taskIds: string[] = [];

  for (const workflowId of window.workflowIds) {
    const workflow = stores.workflows.getById(workflowId);
    if (!workflow || !workflow.enabled) {continue;}
    const result = await executeWorkflow(workflow, { stores, dataService: ds });
    collectTasksFromWorkflow(taskIds, result);
  }

  for (const taskId of taskIds) {
    const runId = runForTask(taskId);
    if (runId && !runIds.includes(runId)) {runIds.push(runId);}
  }

  assignAgents(window, runIds);

  const now = nowIso();
  stores.executionWindows.update(window.id, {
    status: 'running',
    startedAt: now,
    taskIds: [...window.taskIds, ...taskIds],
    runIds: [...window.runIds, ...runIds],
    updatedAt: now
  });

  const updated = stores.executionWindows.getById(window.id)!;
  recordAudit({ actor: actorId || 'control-center', action: 'execwindow.start', targetType: 'executionWindow', targetId: window.id, details: { runCount: runIds.length } });
  emitEvent('execwindow.started', 'execwindow', { windowId: window.id, name: window.name, runCount: runIds.length });

  if (runIds.length === 0) {
    finalizeWindow(updated);
    return stores.executionWindows.getById(window.id)!;
  }

  void kickWindowPass(updated);
  return updated;
}

export function cancelExecutionWindow(windowId: string, actorId?: string): ExecutionWindow {
  const stores = getStores();
  const window = stores.executionWindows.getById(windowId);
  if (!window) {throw new Error(`Execution window not found: ${windowId}`);}
  if (window.status !== 'planned' && window.status !== 'running') {
    throw new Error(`Execution window ${window.id} is already ${window.status}`);
  }

  for (const runId of window.runIds) {
    const run = stores.runs.getById(runId);
    if (run && (run.status === 'queued' || run.status === 'running')) {
      queueService.cancelRun(runId, actorId || run.agentId);
    }
  }

  const now = nowIso();
  stores.executionWindows.update(window.id, { status: 'cancelled', finishedAt: now, updatedAt: now });
  recordAudit({ actor: actorId || 'control-center', action: 'execwindow.cancel', targetType: 'executionWindow', targetId: window.id });
  emitEvent('execwindow.cancelled', 'execwindow', { windowId: window.id, name: window.name });
  return stores.executionWindows.getById(windowId)!;
}