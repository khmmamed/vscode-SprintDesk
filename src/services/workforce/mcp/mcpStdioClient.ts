import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { McpServerConfig } from '../../../data/types';
import { McpClient, McpRequestError, McpServerInfo, McpToolDefinition, JsonRpcRequest, JsonRpcResponse, buildRequest } from './mcpClient';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export class StdioMcpClient implements McpClient {
  readonly kind = 'stdio' as const;
  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pending = new Map<string | number, PendingRequest>();
  private closed = false;

  constructor(private readonly server: McpServerConfig) {}

  private ensureStarted(): void {
    if (this.child) {
      return;
    }
    if (!this.server.command) {
      throw new Error(`mcp server ${this.server.id} has no command`);
    }
    const child = spawn(this.server.command, this.server.args || [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: false
    });
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout! });
    this.rl = rl;
    rl.on('line', line => {
      let data: JsonRpcResponse;
      try {
        data = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      const id = data.id as string | number | undefined;
      if (id === undefined || id === null) {
        return; // server-initiated notification: ignored for now
      }
      const pendingReq = this.pending.get(id);
      if (!pendingReq) {
        return;
      }
      this.pending.delete(id);
      if (data.error) {
        pendingReq.reject(new McpRequestError(data.error.message || 'JSON-RPC error', data.error.code, data.error.data));
      } else {
        pendingReq.resolve(data.result);
      }
    });

    child.on('error', err => {
      for (const pendingReq of this.pending.values()) {
        pendingReq.reject(err);
      }
      this.pending.clear();
    });
    child.on('exit', () => {
      if (!this.closed) {
        for (const pendingReq of this.pending.values()) {
          pendingReq.reject(new Error(`mcp stdio server exited`));
        }
        this.pending.clear();
      }
    });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    this.ensureStarted();
    if (this.closed) {
      return Promise.reject(new Error('mcp stdio client is closed'));
    }
    const request: JsonRpcRequest = buildRequest(method, params);
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.child!.stdin!.write(`${JSON.stringify(request)}\n`);
    });
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
    this.closed = true;
    if (this.child && !this.child.killed) {
      this.child.stdin?.end();
      this.child.kill();
    }
    this.rl?.close();
    this.child = null;
  }
}