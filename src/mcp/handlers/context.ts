import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res, getWs } from './helpers';

function handle_sprintdesk_projectContext(_args: any): HandlerResult {
  const stores = getStores();
  const plans = stores.plans.loadAll();
  const planStatusCounts: Record<string, number> = {};
  plans.forEach(p => {
    const status = p.scheduling.status;
    planStatusCounts[status] = (planStatusCounts[status] || 0) + 1;
  });

  const context = {
    workspace: getWs(),
    counts: {
      plans: plans.length,
      inputs: stores.inputs.count(),
      runs: stores.runs.count(),
      checkpoints: stores.checkpoints.count(),
      findings: stores.findings.count(),
      events: stores.events.count(),
      employees: stores.people.count()
    },
    plansByStatus: planStatusCounts,
    activeRuns: stores.runs.findByStatus('running').length,
    latestEvents: stores.events.latest(10).map(e => ({ id: e.id, type: e.type, source: e.source, timestamp: e.timestamp })),
    hasOpenPlans: plans.some(p => !['done', 'failed', 'cancelled'].includes(p.scheduling.status))
  };

  return res(JSON.stringify(context, null, 2));
}

export const CONTEXT_HANDLERS: Record<string, Handler> = {
  sprintdesk_projectContext: handle_sprintdesk_projectContext,
};