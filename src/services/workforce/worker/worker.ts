import { getWorkspaceRoot } from '../../fileService';
import { getDataService } from '../../../data/DataService';
import { getStores } from '../../../data/stores';
import { AgentConfig, Employee, Run, Task, WorkerMode } from '../../../data/types';
import { finishRun, getQueueSettings, processQueue, requeueRun, QueueClaim, QueueSkip } from '../queueService';
import { createHeadlessWorker } from './headlessWorker';
import { createNoopWorker } from './noopWorker';
import { createTerminalWorker } from './terminalWorker';

export interface WorkerRequest {
  run: Run;
  task: Task;
  employee: Employee;
  agentConfig: AgentConfig;
  workspaceRoot: string;
  timeoutMs?: number;
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
    case 'headless':
    default:
      return createHeadlessWorker();
  }
}

export async function executeRun(runId: string, mode?: WorkerMode): Promise<WorkerResult | undefined> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {return undefined;}

  const run = getStores().runs.getById(runId);
  if (!run || run.status !== 'running') {return undefined;}

  const ds = getDataService(wsRoot);
  const task = ds.getTask(run.taskId);
  if (!task) {return undefined;}

  const employee = getStores().employees.getById(run.agentId || '');
  if (!employee) {return undefined;}
  if (!employee.agentConfig) {
    finishRun(runId, { status: 'failed', error: 'Agent not configured', classification: 'invalid-config' });
    return { status: 'failed', error: 'Agent not configured', classification: 'invalid-config' };
  }

  const runtime = getWorkerRuntime(mode);
  const result = await runtime.run({
    run,
    task,
    employee,
    agentConfig: employee.agentConfig,
    workspaceRoot: wsRoot,
    timeoutMs: getQueueSettings().runTimeoutMs
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