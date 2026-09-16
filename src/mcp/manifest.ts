import { SERVER_INFO } from './core';
import {
  AGENT_TOOLS,
  RUN_TOOLS,
  QUEUE_TOOLS,
  EVENT_TOOLS,
  AUDIT_TOOLS,
  CONTEXT_TOOLS,
  WORKFORCE_TOOLS,
  HISTORY_TOOLS,
  MCP_TOOLS,
  APPROVAL_TOOLS,
  INPUT_TOOLS,
  PLAN_TOOLS,
  CHECKPOINT_TOOLS,
  CYCLE_TOOLS,
  ORGANIZER_TOOLS,
  ALL_TOOLS
} from './tools';

interface McpManifestToolGroup {
  group: string;
  tools: Array<{ name: string }>;
}

const TOOL_GROUPS: McpManifestToolGroup[] = [
  { group: 'agent', tools: AGENT_TOOLS },
  { group: 'run', tools: RUN_TOOLS },
  { group: 'queue', tools: QUEUE_TOOLS },
  { group: 'event', tools: EVENT_TOOLS },
  { group: 'audit', tools: AUDIT_TOOLS },
  { group: 'context', tools: CONTEXT_TOOLS },
  { group: 'workforce', tools: WORKFORCE_TOOLS },
  { group: 'history', tools: HISTORY_TOOLS },
  { group: 'mcp', tools: MCP_TOOLS },
  { group: 'approvals', tools: APPROVAL_TOOLS },
  { group: 'input', tools: INPUT_TOOLS },
  { group: 'plan', tools: PLAN_TOOLS },
  { group: 'checkpoint', tools: CHECKPOINT_TOOLS },
  { group: 'cycle', tools: CYCLE_TOOLS },
  { group: 'organizer', tools: ORGANIZER_TOOLS }
];

export function buildMcpManifest(): Record<string, unknown> {
  return {
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: 'MCP server for SprintDesk controlled autonomous workforce - exposes plan, run, queue, event, checkpoint, input, cycle, organizer, agent, approval and workforce operations for AI agents',
    author: 'SprintDesk',
    repository: 'https://github.com/khmmamed/vscode-SprintDesk',
    homepage: 'https://github.com/khmmamed/vscode-SprintDesk',
    capabilities: { tools: true, resources: false },
    connection: {
      http: { url: 'http://localhost:3847/mcp', methods: ['POST'] },
      stdio: { command: 'npm run mcp', cwd: '<workspace-root>' }
    },
    toolCount: ALL_TOOLS.length,
    tools: Object.fromEntries(
      TOOL_GROUPS.map(g => [g.group, g.tools.map(t => t.name)])
    ),
    usage: {
      http_curl:
        "curl -X POST http://localhost:3847/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'",
      http_call:
        "curl -X POST http://localhost:3847/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"sprintdesk_plansList\",\"arguments\":{}}}'",
      stdio: 'cd <workspace> && npm run mcp'
    }
  };
}

export function getAllToolGroupNames(): string[] {
  return TOOL_GROUPS.map(g => g.group);
}
