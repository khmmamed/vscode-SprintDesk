import { getStores } from '../../../data/stores';
import { McpServerConfig } from '../../../data/types';

export interface McpServerInput {
  id: string;
  kind: McpServerConfig['kind'];
  name?: string;
  description?: string;
  url?: string;
  command?: string;
  args?: string[];
  headersRef?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export function listMcpServers(): McpServerConfig[] {
  return getStores().mcpServers.loadAll();
}

export function getMcpServer(serverId: string): McpServerConfig | undefined {
  return getStores().mcpServers.findById(serverId);
}

export function upsertMcpServer(input: McpServerInput): McpServerConfig {
  const now = new Date().toISOString();
  const existing = getMcpServer(input.id);
  const server: McpServerConfig = {
    ...(existing ?? {}),
    id: input.id,
    kind: input.kind,
    name: input.name,
    description: input.description,
    url: input.url,
    command: input.command,
    args: input.args,
    headersRef: input.headersRef,
    timeoutMs: input.timeoutMs,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  } as McpServerConfig;
  getStores().mcpServers.upsert(server);
  return server;
}

export function removeMcpServer(serverId: string): boolean {
  if (!getMcpServer(serverId)) {
    return false;
  }
  getStores().mcpServers.delete(serverId);
  return true;
}

export function isServerEnabled(serverId: string): boolean {
  const server = getMcpServer(serverId);
  return !!server && server.enabled !== false;
}