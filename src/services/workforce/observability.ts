import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { getStores } from '../../data/stores';
import { EventRecord, Employee, Run, QueueSettings } from '../../data/types';
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

export function getActivitySummary(recentEventLimit = 20): ActivitySummary {
  const root = fileService.getWorkspaceRoot();
  const stores = getStores();
  const tasks = root ? getDataService(root).loadTasks() : [];

  return {
    asOf: new Date().toISOString(),
    employees: countEmployees(stores.employees.loadAll()),
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