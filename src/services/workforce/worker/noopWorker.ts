import { WorkerRequest, WorkerResult, WorkerRuntime } from './worker';
import { buildAgentCommand } from './commandBuilder';

export function createNoopWorker(): WorkerRuntime {
  return {
    mode: 'noop',
    async run(request: WorkerRequest): Promise<WorkerResult> {
      const { command, args } = buildAgentCommand(
        request.agentConfig,
        request.task.path || '',
        request.task.title,
        request.task.title,
        request.employee.name
      );
      const invocation = command ? [command, ...args].join(' ') : '(no tool configured)';
      return { status: 'completed', output: `noop: ${invocation}` };
    }
  };
}