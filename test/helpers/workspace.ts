import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setWorkspaceRootOverride } from '../../src/services/fileService';
import { getStores } from '../../src/data/stores';
import { AgentConfig, Employee, Plan, Run } from '../../src/data/types';
import { materializePlan } from '../../src/services/workforce/plan/planService';

let currentRoot = '';
let sequence = 0;

export interface TestWorkspace {
  root: string;
  cleanup(): void;
}

export function makeWorkspace(): TestWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintdesk-test-'));
  fs.mkdirSync(path.join(root, '.SprintDesk', 'people'), { recursive: true });
  fs.mkdirSync(path.join(root, '.SprintDesk', 'database'), { recursive: true });
  fs.mkdirSync(path.join(root, '.SprintDesk', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(root, '.SprintDesk', 'inputs'), { recursive: true });
  // database/ registry files (Slice K: former workforce/ state now lives here)
  const dbFiles: Record<string, string> = {
    inputs: 'inputs',
    plans: 'plans',
    cycles: 'cycles',
    checkpoints: 'checkpoints',
    executions: 'runs',
    events: 'events',
    audit: 'entries',
    findings: 'findings',
    approvals: 'approvals',
    skills: 'skills',
    tools: 'tools',
    eventRules: 'eventRules',
    classification: 'proposals',
    executionWindows: 'executionWindows'
  };
  for (const [file, key] of Object.entries(dbFiles)) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'database', `${file}.yml`), `${key}: []`, 'utf8');
  }
  // people/ files
  for (const key of ['humans', 'agents']) {
    fs.writeFileSync(path.join(root, '.SprintDesk', 'people', `${key}.yml`), `${key}: []`, 'utf8');
  }
  currentRoot = root;
  setWorkspaceRootOverride(root);
  getStores(root);
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
