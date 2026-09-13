import { listMcpServers, upsertMcpServer, removeMcpServer, getMcpServer } from '../../services/workforce/mcp/registry';
import { listServerTools, callServerTool, inspectServer } from '../../services/workforce/mcp/client';
import { requireCall } from '../../services/workforce/mcp/safety';
import { McpServerKind } from '../../data/types';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_mcpServersList(): HandlerResult {
  return res(JSON.stringify(listMcpServers(), null, 2));
}

function handle_sprintdesk_mcpServersAdd(args: any): HandlerResult {
  const { id, kind, name, description, url, command, args: toolArgs, headersRef, timeoutMs, enabled } = args;
  if (!id || !kind) {
    return res('Provide id and kind ("stdio" | "http")', true);
  }
  if (kind !== 'http' && kind !== 'stdio') {
    return res(`Unsupported mcp kind: ${kind}`, true);
  }
  if (kind === 'http' && !url) {
    return res('http servers require url', true);
  }
  if (kind === 'stdio' && !command) {
    return res('stdio servers require command', true);
  }
  const server = upsertMcpServer({
    id,
    kind: kind as McpServerKind,
    name,
    description,
    url,
    command,
    args: toolArgs,
    headersRef,
    timeoutMs,
    enabled
  });
  return res(JSON.stringify(server, null, 2));
}

function handle_sprintdesk_mcpServersUpdate(args: any): HandlerResult {
  const existing = getMcpServer(args.id);
  if (!existing) {
    return res(`mcp server not registered: ${args.id}`, true);
  }
  const updated = upsertMcpServer({
    id: args.id,
    kind: args.kind ?? existing.kind,
    name: args.name ?? existing.name,
    description: args.description ?? existing.description,
    url: args.url ?? existing.url,
    command: args.command ?? existing.command,
    args: args.args ?? existing.args,
    headersRef: args.headersRef ?? existing.headersRef,
    timeoutMs: args.timeoutMs ?? existing.timeoutMs,
    enabled: args.enabled ?? existing.enabled
  });
  return res(JSON.stringify(updated, null, 2));
}

function handle_sprintdesk_mcpServersRemove(args: any): HandlerResult {
  if (!removeMcpServer(args.id)) {
    return res(`mcp server not registered: ${args.id}`, true);
  }
  return res(JSON.stringify({ removed: args.id }));
}

async function handle_sprintdesk_mcpToolsList(args: any): Promise<HandlerResult> {
  try {
    const { tools } = await listServerTools(args.serverId, args.agent);
    return res(JSON.stringify({ serverId: args.serverId, toolCount: tools.length, tools }, null, 2));
  } catch (e) {
    return res(String((e as Error).message || e), true);
  }
}

function handle_sprintdesk_mcpCheck(args: any): HandlerResult {
  const { serverId, toolName, agent } = args;
  const gate = requireCall(agent, serverId, toolName);
  if (!gate.ok) {
    return res(JSON.stringify({ allowed: false, error: gate.error }, null, 2));
  }
  const info = inspectServer(serverId);
  return res(JSON.stringify({ allowed: true, ...info }, null, 2));
}

async function handle_sprintdesk_mcpCall(args: any): Promise<HandlerResult> {
  const { serverId, toolName, toolArgs, agent } = args;
  if (!serverId || !toolName) {
    return res('Provide serverId and toolName', true);
  }
  try {
    const result = await callServerTool(serverId, toolName, toolArgs || {}, { agentIdOrName: agent });
    const text = result.content
      .map(c => {
        const chunk = c as { type?: string; text?: string };
        return chunk.type === 'text' || typeof chunk.text === 'string' ? String(chunk.text) : JSON.stringify(chunk);
      })
      .join('\n');
    return res(text || JSON.stringify(result.content), !!result.isError);
  } catch (e) {
    return res(String((e as Error).message || e), true);
  }
}

export const MCP_HANDLERS: Record<string, Handler> = {
  sprintdesk_mcpServersList: handle_sprintdesk_mcpServersList,
  sprintdesk_mcpServersAdd: handle_sprintdesk_mcpServersAdd,
  sprintdesk_mcpServersUpdate: handle_sprintdesk_mcpServersUpdate,
  sprintdesk_mcpServersRemove: handle_sprintdesk_mcpServersRemove,
  sprintdesk_mcpToolsList: handle_sprintdesk_mcpToolsList,
  sprintdesk_mcpCheck: handle_sprintdesk_mcpCheck,
  sprintdesk_mcpCall: handle_sprintdesk_mcpCall
};