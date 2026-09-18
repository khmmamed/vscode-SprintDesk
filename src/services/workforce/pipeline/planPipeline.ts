import { getStores } from '../../../data/stores';
import { Plan, PlanPipelineStage } from '../../../data/types';
import { runClassifierStage } from './classifierStage';
import { runOrganizerStage } from './organizerStage';
import { runSchedulerStage } from './schedulerStage';
import { lastRecord, relayLoad, resolveRoot } from './stageSupport';

const TERMINAL_SCHEDULE_STATUSES: ReadonlyArray<Plan['scheduling']['status']> = [
  'done', 'failed', 'cancelled'
];

// Plans the refinement pipeline owns: those materialized from human/agent
// Requests. Synthetic (workflow/schedule) and proposal-derived plans are managed
// by their own producers and must not be rewritten here.
export function isPipelineEligible(plan: Plan): boolean {
  const origin = plan.source?.inputId || '';
  if (origin.startsWith('synthetic:') || origin.startsWith('proposal:')) {
    return false;
  }
  return !TERMINAL_SCHEDULE_STATUSES.includes(plan.scheduling.status);
}

export interface PipelineRunResult {
  planId: string;
  stage: PlanPipelineStage;
  organizer: { ran: boolean; examined: number; changed: number };
}

// Runs the classifier → organizer → scheduler chain over one plan. Every stage is
// idempotent against its input hash, so a steady-state call is a no-op and does
// not emit events.
export async function runPlanPipeline(
  planId: string,
  workspaceRoot?: string
): Promise<PipelineRunResult | undefined> {
  const root = resolveRoot(workspaceRoot);
  let plan = relayLoad(planId, root);
  if (!plan || !isPipelineEligible(plan)) {
    return undefined;
  }

  plan = await runClassifierStage(plan, root);
  const organized = await runOrganizerStage(plan, root);
  plan = await runSchedulerStage(organized.plan, root);

  return {
    planId: plan.id,
    stage: plan.pipeline?.stage || 'reader',
    organizer: organized.organizer
  };
}

export interface RunPendingPipelinesOptions {
  workspaceRoot?: string;
  planIds?: string[];
  cap?: number;
}

export interface RunPendingPipelinesResult {
  examined: number;
  ready: number;
  organizer: { ran: number; examined: number; changed: number };
}

// Advances the refinement chain for the eligible plans. When explicit planIds are
// supplied only those are considered; otherwise every eligible plan is examined,
// bounded by `cap`.
export async function runPendingPipelines(
  opts: RunPendingPipelinesOptions = {}
): Promise<RunPendingPipelinesResult> {
  const root = resolveRoot(opts.workspaceRoot);
  const stores = getStores(root);

  let candidates: Plan[];
  if (opts.planIds) {
    candidates = opts.planIds
      .map(id => stores.plans.getById(id))
      .filter((plan): plan is Plan => Boolean(plan));
  } else {
    candidates = stores.plans.loadAll();
  }

  const organizer = { ran: 0, examined: 0, changed: 0 };
  let ready = 0;
  let examined = 0;

  for (const candidate of candidates) {
    if (opts.cap !== undefined && examined >= opts.cap) {
      break;
    }
    if (!isPipelineEligible(candidate)) {
      continue;
    }
    examined += 1;
    const result = await runPlanPipeline(candidate.id, root);
    if (!result) {
      continue;
    }
    if (result.organizer.ran) {
      organizer.ran += 1;
      organizer.examined += result.organizer.examined;
      organizer.changed += result.organizer.changed;
    }
    if (result.stage === 'ready') {
      ready += 1;
    }
  }

  return { examined, ready, organizer };
}

export interface PlanPipelineSummary {
  stage: PlanPipelineStage;
  ready: boolean;
  lastAt?: string;
  memberId?: string;
  source?: 'deterministic' | 'llm';
}

export function summarizePipeline(plan: Plan): PlanPipelineSummary {
  const latest = lastRecord(plan, plan.pipeline?.stage || 'reader');
  return {
    stage: plan.pipeline?.stage || 'reader',
    ready: plan.pipeline?.stage === 'ready',
    ...(latest?.at ? { lastAt: latest.at } : {}),
    ...(latest?.by ? { memberId: latest.by } : {}),
    ...(latest?.source ? { source: latest.source } : {})
  };
}
