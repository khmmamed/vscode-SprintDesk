import { WorkerRequest, WorkerResult, WorkerRuntime } from './worker';
import { buildAgentCommand } from './commandBuilder';

function getVscode(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode');
  } catch {
    return undefined;
  }
}

export function createTerminalWorker(): WorkerRuntime {
  return {
    mode: 'terminal',
    async run(request: WorkerRequest): Promise<WorkerResult> {
      const vscode = getVscode();
      if (!vscode) {
        return { status: 'failed', error: 'VS Code terminal unavailable in this runtime' };
      }

      const { command, args } = buildAgentCommand(
        request.agentConfig,
        request.task.path || '',
        request.task.title,
        request.task.title,
        request.employee.name
      );

      if (!command) {
        return { status: 'failed', error: 'Invalid agent configuration' };
      }

      const terminal = vscode.window.createTerminal({
        name: `Agent: ${request.employee.name}`,
        cwd: request.workspaceRoot
      });
      terminal.show();
      terminal.sendText([command, ...args].join(' '));

      return { status: 'completed', output: 'Agent started in VS Code terminal' };
    }
  };
}