import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setWorkspaceRootOverride } from '../../src/services/fileService';
import { getStores } from '../../src/data/stores';
import { getDataService } from '../../src/data/DataService';
import { AgentConfig, Employee, Plan, Run, Task } from '../../src/data/types';
import { materializePlan } from '../../src/services/workforce/plan/planService';

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
  fs.mkdirSync(path.join(root, '.SprintDesk', 'people'), { recursive: true });
  fs.mkdirSync(path.join(root, '.SprintDesk', 'database'), { recursive: true });
  for (const key of ['tasks', 'backlogs', 'epics', 'sprints']) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'data', `${key}.yml`), `${key}: []`, 'utf8');
  }
  // v1.0 Slice A — database/ is the single runtime-state boundary; executions.yml
  // keeps its internal `runs` key
  const dbFiles: Record<string, string> = {
    inputs: 'inputs',
    plans: 'plans',
    cycles: 'cycles',
    checkpoints: 'checkpoints',
    executions: 'runs',
    events: 'events',
    audit: 'entries'
  };
  for (const [file, key] of Object.entries(dbFiles)) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'database', `${file}.yml`), `${key}: []`, 'utf8');
  }
  for (const key of ['humans', 'agents']) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'people', `${key}.yml`), `${key}: []`, 'utf8');
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

// v1.0 Slice D — tests build runnable-by-default Plans (the queue's execution unit).
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  const plan = materializePlan(
    {
      sourceInputId: 'test:fixture',
      title: `Plan ${sequence + 1}`,
      description: 'Fixture plan description',
      category: 'feature',
      priority: 'medium',
      executionMode: 'immediate'
    },
    { workspaceRoot: currentWorkspaceRoot() }
  );
  return { ...plan, ...overrides };
}

export function makeRun(planId: string, agentId: string, overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  const run: Run = {
    id: nextId('run'),
    planId,
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