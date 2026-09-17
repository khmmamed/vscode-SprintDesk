import * as path from 'path';
import { AgentConfig } from '../../../data/types';

export function sanitizeBranchName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function buildAgentCommand(
  config: AgentConfig | undefined,
  planPath: string,
  planDescription: string,
  planTitle: string,
  agentName: string
): { command: string; args: string[] } {
  if (!config) {
    return { command: '', args: [] };
  }
  const planDir = planPath && planPath !== 'undefined' ? path.dirname(planPath) : process.cwd();
  const planFile = path.basename(planPath);

  const fullPrompt = `[${agentName}] ${planDescription}\n\nPlan: ${planTitle}\nWork in: ${planDir}`;

  switch (config.tool) {
    case 'opencode': {
      return { command: 'opencode', args: ['-s', '--prompt', fullPrompt] };
    }
    case 'ollama': {
      const model = config.model || 'llama3';
      const prompt = `Plan: ${planTitle}\nWork in: ${planDir}`;
      return { command: 'ollama', args: ['run', model, prompt] };
    }
    case 'claude-code': {
      return { command: 'claude', args: ['code', '--task', planPath] };
    }
    case 'custom': {
      const cmd = (config.command || '')
        .replace(/\{plan_path\}/g, planPath)
        .replace(/\{plan_dir\}/g, planDir)
        .replace(/\{plan_file\}/g, planFile)
        .replace(/\{description\}/g, fullPrompt);
      const parts = cmd.split(' ');
      return { command: parts[0], args: parts.slice(1) };
    }
    default:
      return { command: '', args: [] };
  }
}
