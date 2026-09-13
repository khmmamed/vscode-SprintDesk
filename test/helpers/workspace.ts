import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setWorkspaceRootOverride } from '../../src/services/fileService';
import { getStores } from '../../src/data/stores';
import { getDataService } from '../../src/data/DataService';
import { AgentConfig, Employee, Run, Task } from '../../src/data/types';

let currentRoot = '';
let sequence = 0;

export interface TestWorkspace {
  root: string;
  cleanup(): void;
}

export function makeWorkspace(): TestWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintdesk-test-'));
  fs.mkdirSync(path.join(root, '.SprintDesk', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, '.SprintDesk', 'Tasks'), { recursive: true });
  for (const key of ['tasks', 'backlogs', 'epics', 'sprints']) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'data', `${key}.yml`), `${key}: []`, 'utf8');
  }
  currentRoot = root;
  setWorkspaceRootOverride(root);
  getStores(root);
  getDataService(root).clearConfigCache();
  return {
    root,
    cleanup(): void {
      setWorkspaceRootOverride(undefined);
      currentRoot = '';
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  };
}

export function currentWorkspaceRoot(): string {
  return currentRoot;
}

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}_${Date.now()}`;
}

export function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  const now = new Date().toISOString();
  return {
    id: nextId('emp'),
    name: `Employee ${sequence}`,
    role: 'agent',
    status: 'idle',
    capabilities: [],
    skills: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { tool: 'custom', command: 'echo {description}', ...overrides };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  const number = sequence + 1;
  const task: Task = {
    id: nextId('task'),
    number,
    code: `SPD-${number}`,
    name: `Task ${number}`,
    title: `Task ${number}`,
    type: 'feature',
    status: 'waiting',
    priority: 'medium',
    epic: null,
    backlog: 'features',
    sprint: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  getDataService(currentRoot).addTask(task);
  return task;
}

export function makeRun(taskId: string, agentId: string, overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  const run: Run = {
    id: nextId('run'),
    taskId,
    agentId,
    status: 'queued',
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  getStores().runs.add(run);
  return run;
}