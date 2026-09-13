import { getStores } from '../../../data/stores';
import { McpServerConfig } from '../../../data/types';
import { McpClient, HttpMcpClient } from './mcpClient';
import { StdioMcpClient } from './mcpStdioClient';
import { getMcpServer, isServerEnabled } from './registry';
import { requireCall, requireList } from './safety';
import { resolveCredential } from '../credentials/credentialService';

export type McpSession = McpClient;

export function sessionFor(server: McpServerConfig): McpSession {
  if (server.kind === 'http') {
    return new HttpMcpClient(server);
  }
  return new StdioMcpClient(server);
}

export async function listServerTools(serverId: string, agentIdOrName?: string): Promise<{ tools: Array<{ name: string; description?: string }>; gate?: never }> {
  const server = getMcpServer(serverId);
  if (!server) {
    throw new Error(`mcp server not registered: ${serverId}`);
  }
  const gate = requireList(agentIdOrName, serverId);
  if (!gate.ok) {
    throw new Error(gate.error);
  }
  const session = sessionFor(server);
  try {
    const tools = await session.listTools();
    return { tools };
  } finally {
    await session.close();
  }
}

export interface McpCallResult {
  content: unknown[];
  isError?: boolean;
}

export async function callServerTool(serverId: string, toolName: string, args: Record<string, unknown>, agentContext?: { agentIdOrName: string }): Promise<McpCallResult> {
  const server = getMcpServer(serverId);
  if (!server) {
    throw new Error(`mcp server not registered: ${serverId}`);
  }
  const gate = requireCall(agentContext?.agentIdOrName, serverId, toolName);
  if (!gate.ok) {
    throw new Error(gate.error);
  }
  const session = sessionFor(server);
  try {
    const result = await session.callTool(toolName, args);
    recordCallAudit(server.id, toolName, agentContext?.agentIdOrName, result.isError);
    return result;
  } finally {
    await session.close();
  }
}

export async function inspectServer(serverId: string): Promise<{
  registered: boolean;
  enabled: boolean;
  server?: McpServerConfig;
  hasHeaderSecret: boolean;
}> {
  const server = getMcpServer(serverId);
  return {
    registered: !!server,
    enabled: isServerEnabled(serverId),
    server,
    hasHeaderSecret: !!server?.headersRef && !!resolveCredential(server.headersRef)
  };
}

function recordCallAudit(serverId: string, toolName: string, actor: string | undefined, isError?: boolean): void {
  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actor || 'system',
    action: 'mcp.call',
    targetType: 'mcp-server',
    targetId: serverId,
    details: { tool: toolName, isError },
    timestamp: new Date().toISOString()
  });
}