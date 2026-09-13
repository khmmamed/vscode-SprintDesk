import { YAMLStore } from './BaseStore';
import { McpServerConfig } from '../types';

export class McpServerStore extends YAMLStore<McpServerConfig> {
  constructor(workspaceRoot?: string) {
    super('mcp', 'servers.yml', 'servers', workspaceRoot);
  }

  findById(id: string): McpServerConfig | undefined {
    return this.loadAll().find(s => s.id === id || s.name === id);
  }

  enabledServers(): McpServerConfig[] {
    return this.loadAll().filter(s => s.enabled !== false);
  }

  upsert(server: McpServerConfig): void {
    const all = this.loadAll();
    const index = all.findIndex(s => s.id === server.id);
    if (index !== -1) {
      all[index] = server;
    } else {
      all.push(server);
    }
    this.saveAll(all);
  }
}