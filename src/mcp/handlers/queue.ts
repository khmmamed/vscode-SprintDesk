import { getStores } from '../../data/stores';
import * as queueService from '../../services/workforce/queueService';
import * as worker from '../../services/workforce/worker/worker';
import { requireEmployeePermission } from '../../services/workforce/capabilityService';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_queueGet(args: any): HandlerResult {
  const settings = getStores().queue.getSettings();

  const runs = getStores().runs.loadAll();
  const queued = runs.filter(r => r.status === 'queued');
  const running = runs.filter(r => r.status === 'running');

  const dry = queueService.processQueue({ dryRun: true });

  const capacity = {
    maxConcurrentRuns: settings.maxConcurrentRuns,
    running: running.length,
    available: Math.max(0, settings.maxConcurrentRuns - running.length)
  };

  return res(
    JSON.stringify(
      {
        settings: {
          enabled: settings.enabled,
          autoAssignUnassigned: settings.autoAssignUnassigned,
          workerMode: settings.workerMode,
          pollIntervalMs: settings.pollIntervalMs,
          maxConcurrentRuns: settings.maxConcurrentRuns
        },
        capacity,
        queued: queued.map(r => ({
          runId: r.id,
          planId: r.planId,
          agentId: r.agentId,
          attempts: r.attempts,
          createdAt: r.createdAt
        })),
        running: running.map(r => ({
          runId: r.id,
          planId: r.planId,
          agentId: r.agentId,
          attempts: r.attempts,
          startedAt: r.startedAt
        })),
        nextClaims: dry.claims.map(c => ({
          runId: c.run.id,
          planCode: c.plan.id,
          agentId: c.employee.id,
          agentName: c.employee.name
        })),
        skipped: dry.skipped
      },
      null,
      2
    )
  );
}

async function handle_sprintdesk_queueProcess(args: any): Promise<HandlerResult> {
  const gate = requireEmployeePermission('run:create', args.actorId);
  if (!gate.ok) return res(gate.error, true);

  const result = queueService.processQueue({ dryRun: false, limit: args.limit });

  const executed: any[] = [];
  for (const run of result.started) {
    const runResult = await worker.executeRun(run.id, args.worker);
    executed.push({
      runId: run.id,
      workerMode: args.worker || getStores().queue.getSettings().workerMode,
      status: runResult?.status ?? run.status,
      ok: runResult?.status === 'completed',
      error: runResult?.error,
      output: runResult?.output
    });
  }

  return res(
    JSON.stringify(
      {
        claims: result.claims.map(c => ({
          runId: c.run.id,
          planCode: c.plan.id,
          agentId: c.employee.id,
          agentName: c.employee.name
        })),
        skipped: result.skipped,
        started: result.started.map(r => r.id),
        executed
      },
      null,
      2
    )
  );
}

export const QUEUE_HANDLERS: Record<string, Handler> = {
  sprintdesk_queueGet: handle_sprintdesk_queueGet,
  sprintdesk_queueProcess: handle_sprintdesk_queueProcess,
};