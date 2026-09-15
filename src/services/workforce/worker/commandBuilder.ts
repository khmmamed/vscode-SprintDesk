import * as path from 'path';
import { AgentConfig } from '../../../data/types';

export function sanitizeBranchName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function buildAgentCommand(
  config: AgentConfig | undefined,
  taskPath: string,
  taskDescription: string,
  taskTitle: string,
  agentName: string
): { command: string; args: string[] } {
  if (!config) {
    return { command: '', args: [] };
  }
  const taskDir = taskPath && taskPath !== 'undefined' ? path.dirname(taskPath) : process.cwd();
  const taskFile = path.basename(taskPath);

  const fullPrompt = `[${agentName}] ${taskDescription}\n\nTask: ${taskTitle}\nWork in: ${taskDir}`;

  switch (config.tool) {
    case 'opencode': {
      return { command: 'opencode', args: ['-s', '--prompt', fullPrompt] };
    }
    case 'ollama': {
      const model = config.model || 'llama3';
      const prompt = `Task: ${taskTitle}\nWork in: ${taskDir}`;
      return { command: 'ollama', args: ['run', model, prompt] };
    }
    case 'claude-code': {
      return { command: 'claude', args: ['code', '--task', taskPath] };
    }
    case 'custom': {
      const cmd = (config.command || '')
        .replace(/\{task_path\}/g, taskPath)
        .replace(/\{task_dir\}/g, taskDir)
        .replace(/\{task_file\}/g, taskFile)
        .replace(/\{description\}/g, fullPrompt);
      const parts = cmd.split(' ');
      return { command: parts[0], args: parts.slice(1) };
    }
    default:
      return { command: '', args: [] };
  }
}