import { exec as nodeExec, execSync as nodeExecSync } from 'child_process';
import { IHost, GitUser, MessageType, ExecOptions, ExecResult } from './IHost';

export class NodeHost implements IHost {
  private root: string;

  constructor(options?: { workspaceRoot?: string }) {
    this.root = options?.workspaceRoot || process.env.SPRINTDESK_WORKSPACE || process.cwd();
  }

  getWorkspaceRoot(): string | undefined {
    return this.root;
  }

  showMessage(message: string, type: MessageType = 'info'): void {
    const label = type === 'error'
      ? '[SprintDesk][error]'
      : type === 'warning'
        ? '[SprintDesk][warning]'
        : '[SprintDesk]';
    console.log(`${label} ${message}`);
  }

  async getGitUser(): Promise<GitUser | undefined> {
    try {
      const name = this.execSync('git config user.name').stdout.trim();
      const email = this.execSync('git config user.email').stdout.trim();
      if (!name && !email) return undefined;
      return { name, email };
    } catch {
      return undefined;
    }
  }

  execSync(command: string, options?: ExecOptions): ExecResult {
    const stdout = nodeExecSync(command, {
      cwd: options?.cwd || this.root,
      encoding: options?.encoding || 'utf8',
      maxBuffer: options?.maxBuffer
    }) as string;
    return { stdout, stderr: '' };
  }

  exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      nodeExec(
        command,
        {
          cwd: options?.cwd || this.root,
          encoding: options?.encoding || 'utf8',
          maxBuffer: options?.maxBuffer
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }
}