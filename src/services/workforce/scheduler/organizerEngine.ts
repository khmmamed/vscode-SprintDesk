import { emitEvent, subscribeEvents } from '../events';
import { getQueueSettings } from '../queueService';
import { OrganizeResult, runOrganizerPass } from '../plan/organizer';
import { runSchedulerPass } from './scheduler';

const EVENT_SOURCE = 'organizer';

// Event-path triggers: an organize window opened because an agent became available
// or an execution/dependency completed, so ready pending work can be dispatched
// without waiting for a schedule fire. `organizer.trigger` is deliberately NOT in
// this set (the organizer emits it at the end of every pass) to avoid a cascade.
export const ORGANIZER_TRIGGER_EVENTS: ReadonlySet<string> = new Set([
  'agent.idle',
  'agent.offline',
  'execution.completed',
  'dependency.completed'
]);

function maxPlansPerPass(): number {
  return getQueueSettings().maxPlansPerPass ?? 5;
}

let busy = false;

function runCappedOrganizer(): OrganizeResult {
  if (busy) {
    return { examined: 0, changed: 0, changes: [] };
  }
  busy = true;
  try {
    return runOrganizerPass({ cap: maxPlansPerPass() });
  } finally {
    busy = false;
  }
}

async function schedulerTick(): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  try {
    await runSchedulerPass();
  } finally {
    busy = false;
  }
}

function onTriggerEvent(event: { type: string }): void {
  if (!ORGANIZER_TRIGGER_EVENTS.has(event.type)) {
    return;
  }
  runCappedOrganizer();
  emitEvent('organizer.trigger', EVENT_SOURCE, {
    cause: event.type,
    at: new Date().toISOString()
  });
}

let triggerListener: (() => void) | undefined;

// Installs the event-path trigger subscription (idempotent). Returns an unsubscribe.
export function installOrganizerEventTriggers(): () => void {
  if (triggerListener) {
    return () => {};
  }
  triggerListener = subscribeEvents(onTriggerEvent);
  return () => {
    if (triggerListener) {
      triggerListener();
      triggerListener = undefined;
    }
  };
}

export interface SchedulerDriver {
  stop: () => void;
}

let schedulerInterval: ReturnType<typeof setInterval> | undefined;

// Production wiring: drives runSchedulerPass on an interval honoring
// queueSettings.enabled / pollIntervalMs and installs the event-path triggers.
// When scheduling is disabled the driver is inert — nothing runs until a user
// opts in.
export function startScheduler(): SchedulerDriver {
  if (schedulerInterval !== undefined) {
    clearInterval(schedulerInterval);
    schedulerInterval = undefined;
  }
  const settings = getQueueSettings();
  if (!settings.enabled) {
    return { stop() {} };
  }
  const disposeTriggers = installOrganizerEventTriggers();
  schedulerInterval = setInterval(
    () => {
      void schedulerTick();
    },
    Math.max(10, settings.pollIntervalMs ?? 30000)
  );
  return {
    stop() {
      if (schedulerInterval !== undefined) {
        clearInterval(schedulerInterval);
        schedulerInterval = undefined;
      }
      disposeTriggers();
    }
  };
}