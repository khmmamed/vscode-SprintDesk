import { AGENT_HANDLERS } from './agents';
import { RUN_HANDLERS } from './runs';
import { QUEUE_HANDLERS } from './queue';
import { EVENT_HANDLERS } from './events';
import { HISTORY_HANDLERS } from './history';
import { AUDIT_HANDLERS } from './audit';
import { CONTEXT_HANDLERS } from './context';
import { WORKFORCE_HANDLERS } from './capability';
import { MCP_HANDLERS } from './mcp';
import { ACTIVITY_HANDLERS } from './activity';
import { APPROVAL_HANDLERS } from './approvals';
import { INPUT_HANDLERS } from './inputs';
import { PLAN_HANDLERS } from './plans';
import { CHECKPOINT_HANDLERS } from './checkpoints';
import { CYCLE_HANDLERS } from './cycles';
import { ORGANIZER_HANDLERS } from './organizer';
import { Handler, HandlerResult, res } from './helpers';

export const HANDLERS: Record<string, Handler> = {
  ...AGENT_HANDLERS,
  ...RUN_HANDLERS,
  ...QUEUE_HANDLERS,
  ...EVENT_HANDLERS,
  ...HISTORY_HANDLERS,
  ...AUDIT_HANDLERS,
  ...CONTEXT_HANDLERS,
  ...WORKFORCE_HANDLERS,
  ...MCP_HANDLERS,
  ...ACTIVITY_HANDLERS,
  ...APPROVAL_HANDLERS,
  ...INPUT_HANDLERS,
  ...PLAN_HANDLERS,
  ...CHECKPOINT_HANDLERS,
  ...CYCLE_HANDLERS,
  ...ORGANIZER_HANDLERS
};

export async function handleToolCall(toolName: string, args: any): Promise<HandlerResult> {
  const handler = HANDLERS[toolName];
  if (!handler) {
    return res(`Unknown tool: ${toolName}`, true);
  }
  return handler(args);
}