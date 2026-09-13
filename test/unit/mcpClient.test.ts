import { strict as assert } from 'node:assert';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHttpClient } from '../../src/services/workforce/mcp/mcpClient';
import { HttpMcpClient } from '../../src/services/workforce/mcp/mcpClient';
import { resolveCredential, saveSecret } from '../../src/services/workforce/credentials/credentialService';
import { McpServerConfig } from '../../src/data/types';
import { makeWorkspace, TestWorkspace } from '../helpers/workspace';

interface ClickedRequest {
  method: string;
  params: { name?: string; arguments?: unknown };
  auth: string | undefined;
}

function startFakeMcp(respond: (req: http.IncomingMessage, body: any) => unknown): Promise<{ server: http.Server; port: number; clicked: ClickedRequest[] }> {
  const clicked: ClickedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(text);
      clicked.push({
        method: body.method,
        params: body.params || {},
        auth: req.headers['authorization']
      });
      const payload = respond(req, body);
      const hasError = !!payload && typeof payload === 'object' && 'error' in (payload as object);
      const response = hasError
        ? { jsonrpc: '2.0', id: body.id, error: (payload as { error: unknown }).error }
        : { jsonrpc: '2.0', id: body.id, result: payload };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, clicked });
    });
  });
}

function makeServer(port: number, extra: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-server',
    kind: 'http',
    enabled: true,
    url: `http://127.0.0.1:${port}/mcp`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra
  };
}

describe('MCP HTTP JSON-RPC client', () => {
  it('initializes, lists tools and calls a tool', async () => {
    const { server, port, clicked } = await startFakeMcp((req, body) => {
      if (body.method === 'initialize') {
        return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } };
      }
      if (body.method === 'tools/list') {
        return { tools: [{ name: 'get_time', description: 'returns time' }] };
      }
      if (body.method === 'tools/call') {
        return { content: [{ type: 'text', text: `called ${body.params.name}` }] };
      }
      return { error: { code: -32601, message: 'method not found' } };
    });
    try {
      const mcp = new HttpMcpClient(makeServer(port));
      const info = await mcp.initialize();
      assert.strictEqual(info.serverInfo?.name, 'fake');
      const tools = await mcp.listTools();
      assert.strictEqual(tools.length, 1);
      assert.strictEqual(tools[0].name, 'get_time');
      const call = await mcp.callTool('get_time', {});
      const [chunk] = call.content as Array<{ type: string; text: string }>;
      assert.strictEqual(chunk.text, 'called get_time');
      assert.deepStrictEqual(clicked.map(c => c.method), ['initialize', 'tools/list', 'tools/call']);
    } finally {
      server.close();
    }
  });

  it('rejects JSON-RPC errors surfaced by the server', async () => {
    const { server, port } = await startFakeMcp((req, body) => ({
      error: { code: -32000, message: 'boom' }
    }));
    try {
      const mcp = createHttpClient(makeServer(port));
      await assert.rejects(() => mcp.listTools(), /boom/);
    } finally {
      server.close();
    }
  });

  it('resolves headersRef through the credential facade', async () => {
    let ws: TestWorkspace | undefined;
    try {
      ws = makeWorkspace();
      saveSecret('mcp_headers', JSON.stringify({ authorization: 'Bearer abc' }));
      const { server, port, clicked } = await startFakeMcp(() => ({ tools: [] }));
      try {
        const client = createHttpClient(makeServer(port, { headersRef: 'secret:mcp_headers' }));
        await client.listTools();
        assert.strictEqual(clicked[0].auth, 'Bearer abc');
      } finally {
        server.close();
      }
    } finally {
      ws?.cleanup();
    }
  });

  it('unknown secret refs resolve to no headers', () => {
    assert.strictEqual(resolveCredential('secret:missing_one'), undefined);
    assert.strictEqual(resolveCredential('env:ALSO_MISSING'), undefined);
  });
});