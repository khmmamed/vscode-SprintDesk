#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import { getQueueSettings } from '../services/workforce/queueService';
import { runOrganizerPass } from '../services/workforce/plan/organizer';
import { startScheduler } from '../services/workforce/scheduler/organizerEngine';
import { runSchedulerPass } from '../services/workforce/scheduler/scheduler';

function resolveWorkspace(argv: string[]): string {
  const explicit = argv[2];
  if (explicit && !explicit.startsWith('--') && fs.existsSync(explicit)) {
    return path.resolve(explicit);
  }
  if (process.env.SPRINTDESK_WORKSPACE) {
    return process.env.SPRINTDESK_WORKSPACE;
  }
  return process.cwd();
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

export interface SchedulerCliResult {
  workspace: string;
  action: 'organize' | 'once' | 'continuous';
  evaluatedAt?: string;
  fired?: Array<{ scheduleId: string; planId?: string; organizer?: { examined: number; changed: number } }>;
  skipped?: Array<{ scheduleId: string; reason: string }>;
  organizer?: { examined: number; changed: number };
  changes?: Array<{ planId: string; kind: string; orgStatus: string }>;
  summary?: { fired: number; skipped: number };
  pollIntervalMs?: number;
  note?: string;
  stop?: () => void;
}

export async function buildSchedulerPass(ws: string, argv: string[] = []): Promise<SchedulerCliResult> {
  fileService.setWorkspaceRootOverride(ws);

  if (hasFlag(argv, 'organize')) {
    // Manual force-run: a single capped Organizer pass, independent of schedules.
    const result = runOrganizerPass();
    return {
      workspace: ws,
      action: 'organize',
      organizer: { examined: result.examined, changed: result.changed },
      changes: result.changes.map(c => ({ planId: c.planId, kind: c.kind, orgStatus: c.orgStatus }))
    };
  }

  if (hasFlag(argv, 'once')) {
    const pass = await runSchedulerPass();
    return {
      workspace: ws,
      action: 'once',
      evaluatedAt: pass.evaluatedAt,
      fired: pass.fired.map(f => ({
        scheduleId: f.scheduleId,
        planId: f.planId,
        organizer: f.organizer ? { examined: f.organizer.examined, changed: f.organizer.changed } : undefined
      })),
      skipped: pass.skipped,
      summary: { fired: pass.fired.length, skipped: pass.skipped.length }
    };
  }

  const settings = getQueueSettings();
  if (!settings.enabled) {
    return {
      workspace: ws,
      action: 'continuous',
      note: 'scheduling disabled (queueSettings.enabled=false); no interval driver started'
    };
  }
  const driver = startScheduler();
  return {
    workspace: ws,
    action: 'continuous',
    pollIntervalMs: settings.pollIntervalMs ?? 30000,
    stop: driver.stop
  };
}

function summarize(result: SchedulerCliResult): void {
  const { stop, ...printable } = result;
  void stop;
  console.log(JSON.stringify(printable, null, 2));
}

if (require.main === module) {
  const ws = resolveWorkspace(process.argv);
  buildSchedulerPass(ws, process.argv.slice(2))
    .then(result => {
      summarize(result);
      if (result.action === 'continuous' && result.note) {
        process.exit(0);
      }
      if (result.action === 'continuous' && result.stop) {
        // Keep the interval driver alive; stop cleanly on Ctrl-C.
        process.on('SIGINT', () => {
          result.stop?.();
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    })
    .catch((err: Error) => {
      console.error(`Scheduler error: ${err.message}`);
      process.exit(2);
    });
}