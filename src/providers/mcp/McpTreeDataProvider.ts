import * as vscode from 'vscode';
import { listMcpServers } from '../../services/workforce/mcp/registry';
import { listServerTools } from '../../services/workforce/mcp/client';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

/**
 * MCP servers come from the MCP registry (.SprintDesk/mcp/servers.yml). Tool
 * discovery is delegated to the gated client facade; failures surface as a
 * non-actionable child rather than throwing out of the tree.
 */
export class McpTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.buildServerRows();
    }
    if (element.contextValue === 'mcpServerItem' || element.contextValue === 'mcpServerItemDisabled') {
      return this.buildToolRows(element);
    }
    return [];
  }

  private buildServerRows(): vscode.TreeItem[] {
    const servers = listMcpServers()
      .slice()
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    if (servers.length === 0) {
      return [emptyItem('No MCP servers registered')];
    }

    return servers.map(server => new SectionItem(
      server.name || server.id,
      server.enabled ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      server.enabled ? 'mcpServerItem' : 'mcpServerItemDisabled',
      { kind: 'mcpServer', server },
      {
        icon: server.enabled ? 'server' : 'circle-slash',
        description: `${server.kind} · ${server.enabled ? 'enabled' : 'disabled'}`,
        tooltip: this.serverTooltip(server.id, server.kind, server.enabled, server.url, server.command, server.args)
      }
    ));
  }

  private async buildToolRows(element: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const payload = (element as SectionItem).payload;
    if (!payload || payload.kind !== 'mcpServer') {return [];}
    if (!payload.server.enabled) {
      return [emptyItem('Server is disabled')];
    }

    try {
      const result = await listServerTools(payload.server.id);
      if (result.tools.length === 0) {
        return [emptyItem('No tools reported')];
      }
      return result.tools.map(tool => new SectionItem(
        tool.name,
        vscode.TreeItemCollapsibleState.None,
        'mcpToolItem',
        { kind: 'mcpTool', serverId: payload.server.id, toolName: tool.name },
        {
          icon: 'symbol-method',
          description: tool.description,
          tooltip: `${payload.server.id}/${tool.name}\n${tool.description || ''}`
        }
      ));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [emptyItem(`Tools unavailable: ${message}`)];
    }
  }

  private serverTooltip(id: string, kind: string, enabled: boolean, url?: string, command?: string, args?: string[]): string {
    const lines = [`id: ${id}`, `kind: ${kind}`, `enabled: ${enabled}`];
    if (url) {lines.push(`url: ${url}`);}
    if (command) {lines.push(`command: ${[command, ...(args || [])].join(' ')}`);}
    return lines.join('\n');
  }
}

export const mcpTreeDataProvider = new McpTreeDataProvider();
