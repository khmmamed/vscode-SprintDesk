import { getStores } from '../../../data/stores';
import { emitEvent, subscribeEvents } from '../events';
import { getQueueSettings } from '../queueService';
import { ingestInput, listInputs, orchestrate } from '../orchestrator';
import { runOrganizerPass } from '../plan/organizer';
import { memberForRole } from '../orchestration/roles';

const EVENT_SOURCE = 'intake';

export interface IntakePassResult {
  ingested: string[];
  planned: Record<string, string[]>;
  organizer: { examined: number; changed: number };
  queueEnabled: boolean;
}

export interface IntakePassOptions {
  workspaceRoot?: string;
}

let running = false;
let rerunRequested = false;

// One automatic intake pass: discover unseen Request files → ingest → orchestrate
// (reader/classifier/planner) → organize → record the scheduling decision. Calling
// this repeatedly is safe: dedup is by file hash and by normalized plan objective,
// so the three discovery paths (event, watcher, reconciliation) converge on the
// same inputs and the same logical Plan lineage.
export async function runIntakePass(opts: IntakePassOptions = {}): Promise<IntakePassResult> {
  const root = opts.workspaceRoot;
  if (running) {
    rerunRequested = true;
    return { ingested: [], planned: {}, organizer: { examined: 0, changed: 0 }, queueEnabled: false };
  }
  running = true;
  try {
    const stores = getStores(root);
    const ingested: string[] = [];

    for (const discovered of listInputs(root)) {
      const before = stores.inputs.loadAll().length;
      const input = ingestInput(discovered.path, { source: { type: 'human' }, workspaceRoot: root });
      if (stores.inputs.loadAll().length > before) {
        ingested.push(input.id);
      }
    }

    const planned: Record<string, string[]> = {};
    for (const input of stores.inputs.loadAll().filter(i => i.status === 'new')) {
      const result = await orchestrate(input.id, { workspaceRoot: root });
      if (result.plans.length > 0) {
        planned[input.id] = result.plans.map(p => p.id);
      }
    }

    const planIds = Object.values(planned).flat();
    const organizer = runOrganizerPass({ workspaceRoot: root, planIds: planIds.length ? planIds : undefined });
    emitEvent('orchestration.organizer.completed', EVENT_SOURCE, {
      examined: organizer.examined,
      changed: organizer.changed,
      memberId: memberForRole('organizer', root)?.id
    });

    // Intake stops at the scheduling decision. Execution is gated: the existing
    // scheduler/dispatcher only dispatch when queue execution is enabled.
    const queueEnabled = getQueueSettings().enabled;
    emitEvent('orchestration.scheduler.evaluated', EVENT_SOURCE, {
      queueEnabled,
      executionGated: !queueEnabled,
      planIds,
      memberId: memberForRole('scheduler', root)?.id
    });

    return { ingested, planned, organizer: { examined: organizer.examined, changed: organizer.changed }, queueEnabled };
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleIntakePass({ workspaceRoot: root });
    }
  }
}

// A pass must never fail silently: the event/watcher/driver callers all discard
// the promise, so surface the failure as an event (Activity) and the console.
export function reportIntakeError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    emitEvent('intake.failed', EVENT_SOURCE, { reason });
  } catch {
    // event store unavailable — fall through to the console
  }
  console.error('[SprintDesk] intake pass failed:', reason);
}

// Coalesces bursts of intake events into a single deferred pass.
export function scheduleIntakePass(opts: IntakePassOptions = {}): void {
  setTimeout(() => {
    void runIntakePass(opts).catch(reportIntakeError);
  }, 0);
}

// Wires automatic intake to the event stream. Returns an unsubscribe function.
export function installIntakeEventTriggers(): () => void {
  return subscribeEvents(event => {
    if (event.type === 'input.created') {
      scheduleIntakePass();
    }
  });
}

export interface IntakeDriver {
  dispose(): void;
}

// Always-on reconciliation driver: runs an immediate pass, then re-checks on an
// interval so Request files dropped while no window was open are still picked up.
export function startIntakeDriver(opts: { intervalMs?: number } = {}): IntakeDriver {
  const intervalMs = opts.intervalMs ?? 15000;
  scheduleIntakePass();
  const timer = setInterval(() => {
    void runIntakePass().catch(reportIntakeError);
  }, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    dispose(): void {
      clearInterval(timer);
    }
  };
}
