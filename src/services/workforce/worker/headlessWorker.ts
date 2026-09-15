import { spawn, ChildProcess } from 'child_process';
import { WorkerRequest, WorkerResult, WorkerRuntime } from './worker';
import { buildAgentCommand } from './commandBuilder';

export function createHeadlessWorker(): WorkerRuntime {
  return {
    mode: 'headless',
    async run(request: WorkerRequest): Promise<WorkerResult> {
      const { command, args } = buildAgentCommand(
        request.agentConfig,
        request.input.path || '',
        request.input.title,
        request.input.title,
        request.employee.name
      );

      if (!command) {
        return { status: 'failed', error: 'Invalid agent configuration', classification: 'invalid-config' };
      }

      return new Promise<WorkerResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let attemptNo = 0;
        let currentChild: ChildProcess | undefined;
        let timer: NodeJS.Timeout | undefined;

        const finish = (result: WorkerResult): void => {
          if (!settled) {
            settled = true;
            if (timer) {clearTimeout(timer);}
            resolve(result);
          }
        };

        const spawnWith = (shell: boolean): void => {
          const myNo = ++attemptNo;
          const child = spawn(command, args, {
            cwd: request.workspaceRoot,
            shell,
            env: { ...process.env }
          });
          currentChild = child;
          child.stdout?.on('data', (d) => { stdout += d.toString(); });
          child.stderr?.on('data', (d) => { stderr += d.toString(); });

          child.on('error', (err: Error) => {
            if (myNo !== attemptNo) {return;}
            const code = (err as NodeJS.ErrnoException).code;
            if (!shell && process.platform === 'win32' && code === 'ENOENT') {
              spawnWith(true);
              return;
            }
            finish({ status: 'failed', error: err.message, classification: 'spawn-error' });
          });

          child.on('close', (code) => {
            if (myNo !== attemptNo) {return;}
            if (code === 0) {
              finish({ status: 'completed', output: stdout.trim() });
            } else {
              finish({ status: 'failed', error: stderr.trim() || stdout.trim() || `Process exited with code ${code}`, classification: 'exit-nonzero' });
            }
          });
        };

        spawnWith(false);

        if (request.timeoutMs) {
          timer = setTimeout(() => {
            if (currentChild) {currentChild.kill();}
            finish({ status: 'failed', error: `Timeout after ${request.timeoutMs}ms`, classification: 'timeout' });
          }, request.timeoutMs);
        }
      });
    }
  };
}