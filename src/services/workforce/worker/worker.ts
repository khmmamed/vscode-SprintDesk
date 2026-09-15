import * as path from 'path';
import { getWorkspaceRoot } from '../../fileService';
import { getFileSystem } from '../../../host';
import { getStores } from '../../../data/stores';
import { AgentConfig, Employee, EmployeeModelProfile, Plan, Run, WorkerMode } from '../../../data/types';
import { finishRun, getQueueSettings, processQueue, requeueRun, QueueClaim, QueueSkip } from '../queueService';
import { readPlanMd, resolvePlanFile } from '../plan/planService';
import { createHeadlessWorker } from './headlessWorker';
import { createNoopWorker } from './noopWorker';
import { createOllamaWorker } from './ollamaWorker';
import { createTerminalWorker } from './terminalWorker';

// v1.0 Slice D — a run executes a Plan's artifact (plans/<id>.md). The runtime works
// against `input` (title/description/path); `plan` carries registry state for reference.
export interface PlanExecutionInput {
  title: string;
  description: string;
  path: string;
}

export interface WorkerRequest {
  run: Run;
  plan: Plan;
  input: PlanExecutionInput;
  employee: Employee;
  agentConfig?: AgentConfig;
  workspaceRoot: string;
  timeoutMs?: number;
  modelProfile?: EmployeeModelProfile;
}

// Resolves execution content from the plan artifact. The artifact is authoritative;
// falls back to the plan id when the .md is unreadable (e.g. noop fixtures).
function planExecutionContent(plan: Plan, workspaceRoot: string): { title: string; description: string } {
  try {
    const file = path.join(workspaceRoot, '.SprintDesk', resolvePlanFile(plan));
    if (getFileSystem().exists(file)) {
      const { sections } = readPlanMd(file);
      const title = sections.objective || plan.id;
      const description = sections.implementation || sections.objective;
      return { title, description };
    }
  } catch {
    // fall through to id-based fallback
  }
  return { title: plan.id, description: '' };
}

export interface WorkerResult {
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
  classification?: 'exit-nonzero' | 'timeout' | 'spawn-error' | 'invalid-config';
}

export interface WorkerRuntime {
  readonly mode: WorkerMode;
  run(request: WorkerRequest): Promise<WorkerResult>;
}

export function getWorkerRuntime(mode?: WorkerMode): WorkerRuntime {
  const runtimeMode: WorkerMode = mode || getQueueSettings().workerMode;
  switch (runtimeMode) {
    case 'noop':
      return createNoopWorker();
    case 'terminal':
      return createTerminalWorker();
    case 'ollama':
      return createOllamaWorker();
    case 'headless':
    default:
      return createHeadlessWorker();
  }
}

export type RunnableState = { ok: true } | { ok: false; error: string };

export function resolveRunnableState(employee: Employee, mode?: WorkerMode): RunnableState {
  const effectiveMode: WorkerMode = mode || getQueueSettings().workerMode;
  if (effectiveMode !== 'ollama' && !employee.agentConfig) {
    return { ok: false, error: 'Agent not configured (set agentConfig.tool)' };
  }
  return { ok: true };
}

export async function executeRun(runId: string, mode?: WorkerMode): Promise<WorkerResult | undefined> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {return undefined;}

  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return undefined;}

  const plan = getStores().plans.getById(run.planId);
  if (!plan) {return undefined;}

  const employee = getStores().people.getById(run.agentId || '');
  if (!employee) {return undefined;}

  const runnable = resolveRunnableState(employee, mode);
  if (!runnable.ok) {
    finishRun(runId, { status: 'failed', error: runnable.error, classification: 'invalid-config' });
    return { status: 'failed', error: runnable.error, classification: 'invalid-config' };
  }

  const content = planExecutionContent(plan, wsRoot);
  const runtime = getWorkerRuntime(mode);
  const result = await runtime.run({
    run,
    plan,
    input: {
      title: content.title,
      description: content.description,
      path: path.join(wsRoot, '.SprintDesk', resolvePlanFile(plan))
    },
    employee,
    agentConfig: employee.agentConfig,
    workspaceRoot: wsRoot,
    timeoutMs: getQueueSettings().runTimeoutMs,
    modelProfile: employee.modelProfile
  });

  if (result.status === 'failed' && requeueRun(runId, { classification: result.classification })) {
    return result;
  }

  finishRun(runId, {
    status: result.status,
    result: result.output,
    error: result.error,
    classification: result.classification
  });
  return result;
}

export interface QueuePassOptions {
  limit?: number;
  mode?: WorkerMode;
}

export interface QueuePassResult {
  claims: QueueClaim[];
  skipped: QueueSkip[];
  executed: Array<{ runId: string; result?: WorkerResult }>;
}

export async function runQueuePass(options: QueuePassOptions = {}): Promise<QueuePassResult> {
  const pass = processQueue({ dryRun: false, limit: options.limit });
  const executed: Array<{ runId: string; result?: WorkerResult }> = [];
  for (const run of pass.started) {
    const result = await executeRun(run.id, options.mode);
    executed.push({ runId: run.id, result });
  }
  return { claims: pass.claims, skipped: pass.skipped, executed };
}