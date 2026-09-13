import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig, AgentRole } from '../../../data/types';
import { getWorkspaceRoot } from '../../fileService';

export function sanitizeBranchName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function getRoleFilePath(agentName: string): string {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {return '';}
  return path.join(wsRoot, '.SprintDesk', 'teams', `${agentName}.json`);
}

export function loadAgentRole(agentName: string): AgentRole | undefined {
  const rolePath = getRoleFilePath(agentName);
  if (!rolePath || !fs.existsSync(rolePath)) {return undefined;}

  try {
    const content = fs.readFileSync(rolePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return undefined;
  }
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
  const roleFile = getRoleFilePath(agentName);

  const role = loadAgentRole(agentName);
  const roleDescription = role?.role || '';
  const defaultTemplate = 'Read your role from {roleFile} and work on task {taskFile}';
  const template = role?.promptTemplate || defaultTemplate;

  const fullPrompt = `[${roleDescription}] Read role from ${roleFile} and work on task ${taskPath}`;

  switch (config.tool) {
    case 'opencode': {
      return { command: 'opencode', args: ['-s', '--prompt', fullPrompt] };
    }
    case 'ollama': {
      const model = config.model || role?.model || 'llama3';
      const prompt = `Role: ${roleDescription}\n\nTask: ${taskTitle}\nWork in: ${taskDir}`;
      return { command: 'ollama', args: ['run', model, prompt] };
    }
    case 'claude-code': {
      return { command: 'claude', args: ['code', '--task', taskPath] };
    }
    case 'custom': {
      const cmd = (config.command || role?.command || '')
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