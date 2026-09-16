import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_cyclesList(args: any): HandlerResult {
  const stores = getStores();
  const cycles = stores.cycles.loadAll();
  let filtered = cycles;

  if (args.planId) {
    filtered = filtered.filter(c => c.planIds.includes(args.planId));
  }

  if (args.inputId) {
    filtered = filtered.filter(c => c.inputIds.includes(args.inputId));
  }

  return res(JSON.stringify(filtered, null, 2));
}

export const CYCLE_HANDLERS: Record<string, Handler> = {
  sprintdesk_cyclesList: handle_sprintdesk_cyclesList,
};
