import { WorkerRequest, WorkerResult, WorkerRuntime } from './worker';
import { buildAgentCommand } from './commandBuilder';

export function createNoopWorker(): WorkerRuntime {
  return {
    mode: 'noop',
    async run(request: WorkerRequest): Promise<WorkerResult> {
      const { command, args } = buildAgentCommand(
        request.agentConfig,
        request.input.path || '',
        request.input.title,
        request.input.title,
        request.employee.name
      );
      const invocation = command ? [command, ...args].join(' ') : '(no tool configured)';
      return { status: 'completed', output: `noop: ${invocation}` };
    }
  };
}