import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as handlers from './handlers';
const ALL_TOOLS = (handlers as any).ALL_TOOLS;
const handleToolCall = (handlers as any).handleToolCall;
import { getDataService } from '../data/DataService';
import * as fileService from '../services/fileService';

const PORT = 3847;

function createCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...createCorsHeaders() });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, statusCode: number, message: string) {
  sendJson(res, statusCode, { error: message });
}

async function handleMcpRequest(body: any): Promise<any> {
  const { id, method, params } = body;

  if (method === 'initialize') {
    const toolCapabilities: Record<string, any> = {};
    for (const tool of ALL_TOOLS) {
      toolCapabilities[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema
      };
    }
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: toolCapabilities },
      serverInfo: { name: 'sprintdesk-mcp', version: '1.0.0' }
    };
  }

  if (method === 'tools/list') {
    return { tools: ALL_TOOLS };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const result = await handleToolCall(toolName, toolArgs);
    return { content: result.content };
  }

  if (method === 'ping') {
    return { content: [{ type: 'text', text: 'pong' }] };
  }

  return null;
}

export function startMcpServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, createCorsHeaders());
      res.end();
      return;
    }

    const url = req.url?.split('?')[0] || '/';

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok', server: 'sprintdesk-mcp' });
      return;
    }

    if (req.method === 'GET' && url === '/tools') {
      sendJson(res, 200, { tools: ALL_TOOLS.map((t: any) => t.name) });
      return;
    }

    if (req.method === 'POST' && url === '/mcp') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const result = await handleMcpRequest(request);
          if (result) {
            sendJson(res, 200, { jsonrpc: '2.0', id: request.id, result });
          } else {
            sendJson(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
          }
        } catch (e: any) {
          sendJson(res, 400, { jsonrpc: '2.0', id: 0, error: { code: -32700, message: e.message } });
        }
      });
      return;
    }

    if (req.method === 'GET') {
      const indexPath = path.join(__dirname, '..', '..', '.SprintDesk', 'mcp', 'README.md');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    }

    sendError(res, 404, 'Not found');
  });

  server.listen(PORT, () => {
    console.log(`🚀 SprintDesk MCP server running on http://localhost:${PORT}`);
    vscode.window.showInformationMessage(`🚀 MCP server running on port ${PORT}`);
  });

  return server;
}

export function stopMcpServer(server: http.Server) {
  server.close();
}