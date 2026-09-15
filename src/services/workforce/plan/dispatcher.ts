import { getStores } from '../../../data/stores';
import { Employee, EventRecord, Plan, Run } from '../../../data/types';
import { cancelRun, createRun, requeueRun, RunFailureClassification } from '../queueService';
import { emitEvent, subscribeEvents } from '../events';

const EVENT_SOURCE = 'dispatcher';

// v1.0 Slice E — the thin Dispatcher. It consumes Organizer execution decisions
// (plan.execution.*) and translates them into queue actions via queueService only.
// It never classifies, plans, recovers, validates or checkpoints; decisions are data.
//
// Integer / idempotence invariants:
// - a decision is translated at most once per plan (guarded, see enqueuePlan);
// - translations are the single work-creating path Dispatcher -> Queue -> Worker.

export type DispatchAction = 'enqueued' | 'run-updated' | 'removed' | 'requeued' | 'noop';

export interface DispatchOutcome {
  planId: string;
  event: string;
  action: DispatchAction;
  runId?: string;
  agentId?: string;
  reason?: string;
}

const PLAN_EXECUTION_EVENTS: ReadonlySet<string> = new Set([
  'plan.execution.requested',
  'plan.execution.delayed',
  'plan.execution.cancelled',
  'plan.execution.reassigned',
  'plan.execution.requeued'
]);

function store() {
  return getStores();
}

function noop(planId: string, event: string, reason: string): DispatchOutcome {
  return { planId, event, action: 'noop', reason };
}

function planIdOf(event: EventRecord): string | undefined {
  return typeof event.payload?.planId === 'string' ? event.payload.planId : undefined;
}

function resolveEmployee(idOrName?: string): Employee | undefined {
  if (!idOrName) {
    return undefined;
  }
  return store()
    .people.loadAll()
    .find(e => e.id === idOrName || e.name === idOrName);
}

function queuedOrRunning(planId: string): Run | undefined {
  return [...store().runs.findByPlanId(planId)].reverse().find(
    r => r.status === 'queued' || r.status === 'running'
  );
}

function queuedRun(planId: string): Run | undefined {
  return [...store().runs.findByPlanId(planId)].reverse().find(r => r.status === 'queued');
}

function runningRun(planId: string): Run | undefined {
  return [...store().runs.findByPlanId(planId)].reverse().find(r => r.status === 'running');
}

// ---------------------------------------------------------------------------
// Translations — one planner decision in, one queue outcome out (never two Runs).
// ---------------------------------------------------------------------------

export function enqueuePlan(planId: string): DispatchOutcome {
  const event = 'plan.execution.requested';
  const plan = store().plans.getById(planId);
  if (!plan) {
    return noop(planId, event, 'plan-not-found');
  }
  if (plan.organization.status !== 'organized') {
    return noop(planId, event, `organization=${plan.organization.status}`);
  }
  if (plan.scheduling.status !== 'ready') {
    return noop(planId, event, `scheduling=${plan.scheduling.status}`);
  }
  if (plan.scheduling.mode !== 'immediate') {
    return noop(planId, event, `mode=${plan.scheduling.mode}`);
  }
  const agentId = plan.execution.assignedAgent;
  if (!agentId) {
    return noop(planId, event, 'no-assigned-agent');
  }
  if (queuedOrRunning(planId)) {
    return noop(planId, event, 'run-exists');
  }
  const run = createRun(planId, agentId);
  return { planId, event, action: 'enqueued', runId: run.id, agentId: run.agentId };
}

function handleDelayed(event: EventRecord, planId: string | undefined): DispatchOutcome {
  if (!planId) {
    return noop('', event.type, 'no-plan-id');
  }
  const run = queuedRun(planId);
  if (!run) {
    return noop(planId, event.type, 'nothing-queued');
  }
  cancelRun(run.id, run.agentId);
  return { planId, event: event.type, action: 'removed', runId: run.id, agentId: run.agentId };
}

function handleCancelled(event: EventRecord, planId: string | undefined): DispatchOutcome {
  if (!planId) {
    return noop('', event.type, 'no-plan-id');
  }
  const run = queuedOrRunning(planId);
  if (!run) {
    return noop(planId, event.type, 'nothing-queued');
  }
  cancelRun(run.id, run.agentId);
  return { planId, event: event.type, action: 'removed', runId: run.id, agentId: run.agentId };
}

function handleReassigned(event: EventRecord, planId: string | undefined): DispatchOutcome {
  if (!planId) {
    return noop('', event.type, 'no-plan-id');
  }
  const agent =
    resolveEmployee(typeof event.payload?.agentId === 'string' ? event.payload.agentId : undefined) ||
    resolveEmployee(typeof event.payload?.agentName === 'string' ? event.payload.agentName : undefined);
  if (!agent) {
    return noop(planId, event.type, 'agent-not-found');
  }
  const plan: Plan | undefined = store().plans.getById(planId);
  if (!plan) {
    return noop(planId, event.type, 'plan-not-found');
  }
  const now = new Date().toISOString();
  store().plans.update(planId, {
    execution: { ...plan.execution, assignedAgent: agent.id },
    updatedAt: now
  });
  const run = queuedOrRunning(planId);
  if (run) {
    store().runs.update(run.id, { agentId: agent.id, updatedAt: now });
    return { planId, event: event.type, action: 'run-updated', runId: run.id, agentId: agent.id };
  }
  if (plan.organization.status === 'organized' && plan.scheduling.status === 'ready' && plan.scheduling.mode === 'immediate') {
    const created = createRun(planId, agent.id);
    return { planId, event: event.type, action: 'enqueued', runId: created.id, agentId: created.agentId };
  }
  return noop(planId, event.type, 'not-ready');
}

function handleRequeued(event: EventRecord, planId: string | undefined): DispatchOutcome {
  if (!planId) {
    return noop('', event.type, 'no-plan-id');
  }
  const run = runningRun(planId);
  if (!run) {
    return noop(planId, event.type, 'no-running-run');
  }
  const classification = typeof event.payload?.classification === 'string'
    ? (event.payload.classification as RunFailureClassification)
    : undefined;
  const requeued = requeueRun(run.id, classification !== undefined ? { classification } : undefined);
  if (!requeued) {
    return noop(planId, event.type, 'requeue-declined');
  }
  return { planId, event: event.type, action: 'requeued', runId: run.id, agentId: run.agentId };
}

const HANDLERS = new Map<string, (event: EventRecord, planId: string | undefined) => DispatchOutcome>([
  ['plan.execution.requested', (_event, planId) => enqueuePlan(planId || '')],
  ['plan.execution.delayed', handleDelayed],
  ['plan.execution.cancelled', handleCancelled],
  ['plan.execution.reassigned', handleReassigned],
  ['plan.execution.requeued', handleRequeued]
]);

export function dispatchPlanEvent(event: EventRecord): DispatchOutcome {
  const planId = planIdOf(event);
  const handler = HANDLERS.get(event.type);
  if (!handler) {
    return noop(planId || '', event.type, 'unhandled');
  }
  try {
    return handler(event, planId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitEvent('dispatcher.skipped', EVENT_SOURCE, { eventType: event.type, planId: planId || '', reason });
    return noop(planId || '', event.type, reason);
  }
}

// ---------------------------------------------------------------------------
// Wiring — event-rule subscription so organizer decisions cause execution
// without the Organizer touching the queue.
// ---------------------------------------------------------------------------

let installed = false;

export function installDispatcher(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;
  const unsubscribe = subscribeEvents(event => {
    if (PLAN_EXECUTION_EVENTS.has(event.type)) {
      dispatchPlanEvent(event);
    }
  });
  return () => {
    unsubscribe();
    installed = false;
  };
}

// ---------------------------------------------------------------------------
// Decision intake — record an externally-decided execution change as a sticky
// registry decision and emit it for the Dispatcher (and any other consumer).
// ---------------------------------------------------------------------------

export function requestPlanCancellation(planId: string): EventRecord {
  const plan = store().plans.getById(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  store().plans.update(planId, {
    scheduling: { ...plan.scheduling, status: 'cancelled' },
    updatedAt: new Date().toISOString()
  });
  return emitEvent('plan.execution.cancelled', 'organizer', { planId });
}

export function requestPlanReassignment(planId: string, agentIdOrName: string): EventRecord {
  const plan = store().plans.getById(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  const agent = resolveEmployee(agentIdOrName);
  if (!agent) {
    throw new Error(`Agent not found: ${agentIdOrName}`);
  }
  store().plans.update(planId, {
    execution: { ...plan.execution, assignedAgent: agent.id },
    updatedAt: new Date().toISOString()
  });
  return emitEvent('plan.execution.reassigned', 'organizer', {
    planId,
    agentId: agent.id,
    agentName: agent.name
  });
}

export function requestPlanRequeue(planId: string, opts: { classification?: RunFailureClassification } = {}): EventRecord {
  const plan = store().plans.getById(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  return emitEvent('plan.execution.requeued', 'organizer', {
    planId,
    ...(opts.classification ? { classification: opts.classification } : {})
  });
}