import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res } from './helpers';

async function handle_sprintdesk_agentsList(_args: any): Promise<HandlerResult> {
  const agents = getStores().people.findByRole('agent').map(e => ({
    id: e.id,
    name: e.name,
    role: e.role,
    status: e.status,
    capabilities: e.capabilities
  }));
  return res(JSON.stringify(agents, null, 2));
}

async function handle_sprintdesk_agentsGet(args: any): Promise<HandlerResult> {
  const agentId = args.agentId;
  if (!agentId) return res('agentId required', true);

  const employee = getStores().people.getById(agentId);
  if (employee) {
    return res(JSON.stringify(employee, null, 2));
  }

  return res(`Agent not found: ${agentId}`, true);
}

export const AGENT_HANDLERS: Record<string, Handler> = {
  sprintdesk_agentsList: handle_sprintdesk_agentsList,
  sprintdesk_agentsGet: handle_sprintdesk_agentsGet,
};
