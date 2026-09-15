import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { getStores } from '../../data/stores';
import { EventRecord, Employee, ExecutionWindow, Finding, Run, QueueSettings, Task, WorkerMode } from '../../data/types';
import { getQueueSettings } from './queueService';

export interface RunCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface EmployeeCounts {
  total: number;
  agents: number;
  humans: number;
  idle: number;
  busy: number;
  offline: number;
}

export interface ActivitySummary {
  asOf: string;
  employees: EmployeeCounts;
  runs: RunCounts;
  tasks: { total: number; active: number; done: number };
  queue: QueueSettings;
  recentEvents: EventRecord[];
}

// v0.11 slice 6 — operational execution / runs & queue visibility (read-only reports)
export type RunFilter = 'all' | 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';

export function getRunsByFilter(filter: RunFilter, limit = 500): Run[] {
  const all = getStores().runs.loadAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  function isRetryingRun(r: Run): boolean {
    return r.status === 'queued' && !!r.availableAt && r.availableAt > new Date().toISOString();
  }

  if (filter === 'all') {return all.slice(0, limit);}
  if (filter === 'retrying') {return all.filter(isRetryingRun).slice(0, limit);}
  if (filter === 'queued') {return all.filter(r => r.status === 'queued' && !isRetryingRun(r)).slice(0, limit);}
  return all.filter(r => r.status === filter).slice(0, limit);
}

export interface RunTriggerReport {
  ruleId: string;
  ruleName: string;
  eventType: string;
}

export interface RunDetailReport {
  run: Run;
  task?: Task;
  employee?: Employee;
  trigger?: RunTriggerReport;
  findings: Finding[];
  durationMs?: number;
}

function findTriggerForTask(taskId: string): RunTriggerReport | undefined {
  for (const rule of getStores().eventRules.loadAll()) {
    for (const trigger of rule.recentTriggers || []) {
      if ((trigger.createdTaskIds || []).includes(taskId)) {
        return { ruleId: rule.id, ruleName: rule.name, eventType: trigger.eventType };
      }
    }
  }
  return undefined;
}

export function runDetail(run: Run): RunDetailReport {
  const root = fileService.getWorkspaceRoot();
  const task = root && run.taskId ? getDataService(root).getTask(run.taskId) : undefined;
  const employee = run.agentId ? getStores().people.getById(run.agentId) : undefined;
  const trigger = task ? findTriggerForTask(task.id) : undefined;
  const findings = getStores()
    .findings.byRunId(run.id)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const durationMs =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : undefined;
  return { run, task, employee, trigger, findings, durationMs };
}

export interface QueueSnapshot {
  asOf: string;
  runs: RunCounts;
  waitingRetry: number;
  multiAttempt: number;
  workerMode: WorkerMode;
  maxConcurrentRuns: number;
  allocated: number;
  busyEmployees: number;
  idleAgents: number;
  offlineAgents: number;
}

export function getQueueSnapshot(): QueueSnapshot {
  const stores = getStores();
  const runs = stores.runs.loadAll();
  const employees = stores.people.loadAll();
  const settings = getQueueSettings();
  const now = new Date().toISOString();
  return {
    asOf: now,
    runs: countRuns(runs),
    waitingRetry: runs.filter(r => r.status === 'queued' && !!r.availableAt && r.availableAt > now).length,
    multiAttempt: runs.filter(r => r.attempts > 1).length,
    workerMode: settings.workerMode,
    maxConcurrentRuns: settings.maxConcurrentRuns,
    allocated: runs.filter(r => r.status === 'running').length,
    busyEmployees: employees.filter(e => e.status === 'busy').length,
    idleAgents: employees.filter(e => e.role === 'agent' && e.status === 'idle').length,
    offlineAgents: employees.filter(e => e.role === 'agent' && e.status === 'offline').length
  };
}

function countRuns(runs: Run[]): RunCounts {
  return {
    queued: runs.filter(r => r.status === 'queued').length,
    running: runs.filter(r => r.status === 'running').length,
    completed: runs.filter(r => r.status === 'completed').length,
    failed: runs.filter(r => r.status === 'failed').length,
    cancelled: runs.filter(r => r.status === 'cancelled').length
  };
}

function countEmployees(employees: Employee[]): EmployeeCounts {
  return {
    total: employees.length,
    agents: employees.filter(e => e.role === 'agent').length,
    humans: employees.filter(e => e.role === 'human').length,
    idle: employees.filter(e => e.status === 'idle').length,
    busy: employees.filter(e => e.status === 'busy').length,
    offline: employees.filter(e => e.status === 'offline').length
  };
}

// v0.11 slice 7 — execution windows report (runs/findings/validation progress, derived live)
export interface ExecutionWindowReport {
  id: string;
  name: string;
  goal?: string;
  status: ExecutionWindow['status'];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  workflowNames: string[];
  agentNames: string[];
  runCount: number;
  runs: RunCounts;
  taskCount: number;
  findings: { total: number; pendingAgentReview: number; pendingHumanReview: number; approved: number; rejected: number };
  completionSummary?: ExecutionWindow['completionSummary'];
}

export function getExecutionWindowReport(window: ExecutionWindow): ExecutionWindowReport {
  const stores = getStores();
  const runs = window.runIds.map(id => stores.runs.getById(id)).filter((r): r is Run => !!r);
  const findings = stores.findings.loadAll().filter(f => f.source?.runId && window.runIds.includes(f.source.runId));
  const durationMs =
    window.startedAt && window.finishedAt
      ? new Date(window.finishedAt).getTime() - new Date(window.startedAt).getTime()
      : undefined;
  return {
    id: window.id,
    name: window.name,
    goal: window.goal,
    status: window.status,
    createdAt: window.createdAt,
    startedAt: window.startedAt,
    finishedAt: window.finishedAt,
    durationMs,
    workflowNames: window.workflowIds
      .map(id => stores.workflows.getById(id)?.name)
      .filter((n): n is string => !!n),
    agentNames: window.agentIds
      .map(id => stores.people.getById(id)?.name)
      .filter((n): n is string => !!n),
    runCount: runs.length,
    runs: {
      queued: runs.filter(r => r.status === 'queued').length,
      running: runs.filter(r => r.status === 'running').length,
      completed: runs.filter(r => r.status === 'completed').length,
      failed: runs.filter(r => r.status === 'failed').length,
      cancelled: runs.filter(r => r.status === 'cancelled').length
    },
    taskCount: window.taskIds.length,
    findings: {
      total: findings.length,
      pendingAgentReview: findings.filter(f => f.status === 'pending' && !f.agentReview).length,
      pendingHumanReview: findings.filter(f => f.status === 'pending' && !!f.agentReview).length,
      approved: findings.filter(f => f.status === 'approved').length,
      rejected: findings.filter(f => f.status === 'rejected').length
    },
    completionSummary: window.completionSummary
  };
}

export function getActivitySummary(recentEventLimit = 20): ActivitySummary {
  const root = fileService.getWorkspaceRoot();
  const stores = getStores();
  const tasks = root ? getDataService(root).loadTasks() : [];

  return {
    asOf: new Date().toISOString(),
    employees: countEmployees(stores.people.loadAll()),
    runs: countRuns(stores.runs.loadAll()),
    tasks: {
      total: tasks.length,
      active: tasks.filter(t => t.workStatus === 'in-progress' && t.status !== 'done' && t.status !== 'cancelled').length,
      done: tasks.filter(t => t.status === 'done').length
    },
    queue: getQueueSettings(),
    recentEvents: stores.events.latest(recentEventLimit)
  };
}