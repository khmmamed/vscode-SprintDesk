import { YAMLStore } from './BaseStore';
import { Tool } from '../types';

export const DEFAULT_TOOLS: Tool[] = [
  { id: 'tool_git', name: 'git', category: 'vcs', aliases: ['scm'], description: 'Version control operations' },
  { id: 'tool_npm', name: 'npm', category: 'build', aliases: ['node'], description: 'Node package management and scripts' },
  { id: 'tool_docker', name: 'docker', category: 'infra', aliases: ['container'], description: 'Container build and run' },
  { id: 'tool_playwright', name: 'playwright', category: 'testing', aliases: ['e2e', 'browser'], description: 'Browser automation and end-to-end tests' },
  { id: 'tool_typescript', name: 'typescript', category: 'build', aliases: ['ts', 'tsc'], description: 'TypeScript compile and typecheck' }
];

export class ToolStore extends YAMLStore<Tool> {
  constructor(workspaceRoot?: string) {
    super('database', 'tools.yml', 'tools', workspaceRoot);
  }

  findByName(name: string): Tool | undefined {
    const needle = name.trim().toLowerCase();
    return this.loadAll().find(
      t =>
        t.name.toLowerCase() === needle ||
        (t.aliases || []).some(a => a.toLowerCase() === needle)
    );
  }

  personToolNames(): string[] {
    return this.loadAll().map(t => t.name).sort((a, b) => a.localeCompare(b));
  }

  upsert(tool: Tool): Tool {
    const all = this.loadAll();
    const index = all.findIndex(t => t.id === tool.id);
    if (index !== -1) {
      all[index] = tool;
    } else {
      all.push(tool);
    }
    this.saveAll(all);
    return tool;
  }

  seedDefaultTools(): number {
    const all = this.loadAll();
    let added = 0;
    for (const tool of DEFAULT_TOOLS) {
      if (all.some(t => t.name.toLowerCase() === tool.name.toLowerCase())) {
        continue;
      }
      all.push(tool);
      added++;
    }
    if (added > 0) {
      this.saveAll(all);
    }
    return added;
  }
}
