import { postJson } from '../llm/httpTransport';
import { resolveCredential } from '../credentials/credentialService';
import { McpServerConfig } from '../../../data/types';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerInfo {
  protocolVersion?: string;
  capabilities?: { tools?: { listChanged?: boolean }; resources?: unknown };
  serverInfo?: { name?: string; version?: string };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class McpRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

function nextRequestId(): number {
  return Math.floor(Number.MAX_SAFE_INTEGER * Math.random());
}

function decode(data: unknown): JsonRpcResponse {
  const resp = data as JsonRpcResponse;
  if (!resp || resp.jsonrpc !== '2.0') {
    throw new McpRequestError('malformed JSON-RPC response');
  }
  if (resp.error) {
    throw new McpRequestError(resp.error.message || 'JSON-RPC error', resp.error.code, resp.error.data);
  }
  return resp;
}

export function buildRequest(method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: '2.0', id: nextRequestId(), method, ...(params !== undefined ? { params } : {}) };
}

async function jsonRpcPost(url: string, method: string, params: unknown, headers: Record<string, string>, timeoutMs = 60_000): Promise<unknown> {
  const result = await postJson(url, {
    headers,
    body: buildRequest(method, params),
    timeoutMs
  });
  return decode(result.json).result ?? undefined;
}

function resolveHeaders(server: McpServerConfig): Record<string, string> {
  if (!server.headersRef) {
    return {};
  }
  const resolved = resolveCredential(server.headersRef);
  if (!resolved || typeof resolved !== 'string') {
    return {};
  }
  try {
    return JSON.parse(resolved) as Record<string, string>;
  } catch {
    return {};
  }
}

export interface McpClient {
  readonly kind: 'http' | 'stdio';
  initialize(): Promise<McpServerInfo>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }>;
  close(): Promise<void>;
}

export class HttpMcpClient implements McpClient {
  readonly kind = 'http' as const;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(private readonly server: McpServerConfig) {
    if (!server.url) {
      throw new Error(`mcp server ${server.id} has no url`);
    }
    this.url = server.url;
    this.headers = resolveHeaders(server);
    this.timeoutMs = server.timeoutMs || 60_000;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    return jsonRpcPost(this.url, method, params, this.headers, this.timeoutMs);
  }

  async initialize(): Promise<McpServerInfo> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } }
    });
    return (result ?? {}) as McpServerInfo;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: McpToolDefinition[] } | undefined)?.tools;
    return Array.isArray(tools) ? tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }> {
    const result = await this.request('tools/call', { name, arguments: args });
    const call = result as { content?: unknown[]; isError?: boolean } | undefined;
    return { content: call?.content ?? [], isError: call?.isError };
  }

  async close(): Promise<void> {
    // stateless HTTP client: nothing to tear down
  }
}

export function createHttpClient(server: McpServerConfig): HttpMcpClient {
  return new HttpMcpClient(server);
}