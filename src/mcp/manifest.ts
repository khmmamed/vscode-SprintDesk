import { SERVER_INFO } from './core';
import {
  TASK_TOOLS,
  EPIC_TOOLS,
  SPRINT_TOOLS,
  BACKLOG_TOOLS,
  MOVE_TOOLS,
  TEAM_TOOLS,
  AGENT_TOOLS,
  TASK_WORK_TOOLS,
  RUN_TOOLS,
  QUEUE_TOOLS,
  EVENT_TOOLS,
  AUDIT_TOOLS,
  CONTEXT_TOOLS,
  WORKFORCE_TOOLS,
  HISTORY_TOOLS,
  MCP_TOOLS,
  APPROVAL_TOOLS,
  ALL_TOOLS
} from './tools';

interface McpManifestToolGroup {
  group: string;
  tools: Array<{ name: string }>;
}

const TOOL_GROUPS: McpManifestToolGroup[] = [
  { group: 'task', tools: TASK_TOOLS },
  { group: 'epic', tools: EPIC_TOOLS },
  { group: 'sprint', tools: SPRINT_TOOLS },
  { group: 'backlog', tools: BACKLOG_TOOLS },
  { group: 'move', tools: MOVE_TOOLS },
  { group: 'team', tools: TEAM_TOOLS },
  { group: 'agent', tools: AGENT_TOOLS },
  { group: 'workflow', tools: TASK_WORK_TOOLS },
  { group: 'run', tools: RUN_TOOLS },
  { group: 'queue', tools: QUEUE_TOOLS },
  { group: 'event', tools: EVENT_TOOLS },
  { group: 'audit', tools: AUDIT_TOOLS },
  { group: 'context', tools: CONTEXT_TOOLS },
  { group: 'workforce', tools: WORKFORCE_TOOLS },
  { group: 'history', tools: HISTORY_TOOLS },
  { group: 'mcp', tools: MCP_TOOLS },
  { group: 'approvals', tools: APPROVAL_TOOLS }
];

export function buildMcpManifest(): Record<string, unknown> {
  return {
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: 'MCP server for SprintDesk controlled autonomous workforce - exposes task, run, queue, event, workflow, provider, MCP, approval and workforce operations for AI agents',
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
        "curl -X POST http://localhost:3847/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"sprintdesk_listTasks\",\"arguments\":{}}}'",
      stdio: 'cd <workspace> && npm run mcp'
    }
  };
}

export function getAllToolGroupNames(): string[] {
  return TOOL_GROUPS.map(g => g.group);
}
