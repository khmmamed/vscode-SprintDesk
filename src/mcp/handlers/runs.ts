import { getStores } from '../../data/stores';
import { requireEmployeePermission } from '../../services/workforce/capabilityService';
import * as queueService from '../../services/workforce/queueService';
import { Handler, HandlerResult, res, getWs } from './helpers';

async function handle_sprintdesk_runsCreate(args: any): Promise<HandlerResult> {
  if (!getWs()) return res('No workspace found', true);

  try {
    // v1.0 Slice D — createRun is Plan-scoped (planId replaces taskId).
    const run = queueService.createRun(args.planId, args.agentId, { actor: 'mcp' });
    return res(JSON.stringify(run, null, 2));
  } catch (e: any) {
    return res(e.message, true);
  }
}

async function handle_sprintdesk_runsList(args: any): Promise<HandlerResult> {
  const runs = getStores().runs.loadAll();

  if (args.planId) {
    return res(JSON.stringify(runs.filter(r => r.planId === args.planId).slice(0, args.limit), null, 2));
  }

  if (args.status) {
    return res(JSON.stringify(runs.filter(r => r.status === args.status).slice(0, args.limit), null, 2));
  }

  return res(JSON.stringify(runs.slice(0, args.limit), null, 2));
}

async function handle_sprintdesk_runsGet(args: any): Promise<HandlerResult> {
  const run = getStores().runs.getById(args.runId);
  if (!run) return res(`Run not found: ${args.runId}`, true);
  return res(JSON.stringify(run, null, 2));
}

async function handle_sprintdesk_runsCancel(args: any): Promise<HandlerResult> {
  const run = getStores().runs.getById(args.runId);
  if (!run) return res(`Run not found: ${args.runId}`, true);
  if (run.status !== 'queued' && run.status !== 'running') {
    return res(`Run ${run.id} is not queued or running (status: ${run.status})`, true);
  }

  try {
    const cancelled = queueService.cancelRun(run.id, args.actorId);
    return res(JSON.stringify(cancelled, null, 2));
  } catch (e: any) {
    return res(e.message, true);
  }
}

async function handle_sprintdesk_runsUpdate(args: any): Promise<HandlerResult> {
  const run = getStores().runs.getById(args.runId);
  if (!run) return res(`Run not found: ${args.runId}`, true);
  if (run.status !== 'running') {
    return res(`Run ${run.id} is not running (status: ${run.status})`, true);
  }
  if (args.status !== 'completed' && args.status !== 'failed') {
    return res(`Invalid run status: ${args.status}. Expected 'completed' or 'failed'.`, true);
  }

  const actorId = args.actorId || run.agentId;
  if (!actorId) return res('Actor identity required (run.agentId not set)', true);

  const employee = getStores().people
    .loadAll()
    .find(e => e.id === actorId || e.name === actorId);
  if (!employee) return res(`Caller identity not found: ${actorId}`, true);

  const gate = requireEmployeePermission('run:update', employee.id);
  if (!gate.ok) return res(gate.error, true);

  if (run.agentId && employee.id !== run.agentId) {
    return res(`Caller ${employee.name} is not the worker assigned to run ${run.id}`, true);
  }

  const updated = queueService.finishRun(run.id, {
    status: args.status,
    result: args.result,
    error: args.error
  });

  return res(JSON.stringify(updated, null, 2));
}

export const RUN_HANDLERS: Record<string, Handler> = {
  sprintdesk_runsCreate: handle_sprintdesk_runsCreate,
  sprintdesk_runsList: handle_sprintdesk_runsList,
  sprintdesk_runsGet: handle_sprintdesk_runsGet,
  sprintdesk_runsCancel: handle_sprintdesk_runsCancel,
  sprintdesk_runsUpdate: handle_sprintdesk_runsUpdate,
};