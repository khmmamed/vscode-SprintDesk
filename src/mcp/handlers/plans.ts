import { getStores } from '../../data/stores';
import { recoverFailure } from '../../services/workforce/plan/recovery';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_plansList(args: any): HandlerResult {
  const stores = getStores();
  const plans = stores.plans.loadAll();
  let filtered = plans;

  if (args.status) {
    filtered = filtered.filter(p => p.scheduling.status === args.status);
  }

  if (args.inputId) {
    filtered = filtered.filter(p => p.source.inputId === args.inputId);
  }

  if (args.limit && typeof args.limit === 'number') {
    filtered = filtered.slice(0, args.limit);
  }

  return res(JSON.stringify(filtered, null, 2));
}

function handle_sprintdesk_plansGet(args: any): HandlerResult {
  const stores = getStores();
  const plan = stores.plans.getById(args.planId);
  if (!plan) return res(`Plan not found: ${args.planId}`, true);
  return res(JSON.stringify(plan, null, 2));
}

function handle_sprintdesk_plansReplan(args: any): HandlerResult {
  const stores = getStores();
  const plan = stores.plans.getById(args.planId);
  if (!plan) return res(`Plan not found: ${args.planId}`, true);

  const runs = stores.runs.loadAll();
  const lastRun = runs.filter(r => r.planId === plan.id).pop();
  if (!lastRun) return res(`No runs found for plan ${args.planId}, cannot replan`, true);

  const outcome = recoverFailure({
    planId: plan.id,
    runId: lastRun.id,
    decision: 'replan',
    reason: args.reason || 'manual-replan'
  });

  return res(JSON.stringify(outcome, null, 2));
}

export const PLAN_HANDLERS: Record<string, Handler> = {
  sprintdesk_plansList: handle_sprintdesk_plansList,
  sprintdesk_plansGet: handle_sprintdesk_plansGet,
  sprintdesk_plansReplan: handle_sprintdesk_plansReplan,
};
