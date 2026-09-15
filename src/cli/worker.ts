#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import { getDataService } from '../data/DataService';
import { WorkerMode } from '../data/types';
import * as queueService from '../services/workforce/queueService';
import * as worker from '../services/workforce/worker/worker';

function resolveWorkspace(argv: string[]): string {
  const explicit = argv[2];
  if (explicit && !explicit.startsWith('--') && fs.existsSync(explicit)) return path.resolve(explicit);
  if (process.env.SPRINTDESK_WORKSPACE) return process.env.SPRINTDESK_WORKSPACE;
  return process.cwd();
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function parseMode(value: string | undefined): WorkerMode {
  if (!value) return queueService.getQueueSettings().workerMode;
  if (value === 'headless' || value === 'terminal' || value === 'noop') return value;
  throw new Error(`Invalid worker mode '${value}'. Expected headless | terminal | noop.`);
}

export async function buildQueuePass(ws: string, argv: string[] = []): Promise<any> {
  fileService.setWorkspaceRootOverride(ws);
  getDataService(ws);

  const mode = parseMode(flagValue(argv, 'worker'));
  const limitRaw = flagValue(argv, 'limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw new Error(`Invalid limit '${limitRaw}'. Expected a positive integer.`);
  }

  const pass = await worker.runQueuePass({ mode, limit });

  return {
    workspace: ws,
    workerMode: mode,
    claims: pass.claims.map(c => ({ runId: c.run.id, planCode: c.plan.id, agentName: c.employee.name })),
    skipped: pass.skipped,
    executed: pass.executed.map(e => ({
      runId: e.runId,
      status: e.result?.status ?? 'unknown',
      error: e.result?.error,
      output: e.result?.output
    })),
    summary: {
      claimed: pass.claims.length,
      started: pass.executed.length,
      completed: pass.executed.filter(e => e.result?.status === 'completed').length,
      failed: pass.executed.filter(e => e.result?.status === 'failed').length,
      skipped: pass.skipped.length
    }
  };
}

if (require.main === module) {
  const ws = resolveWorkspace(process.argv);
  buildQueuePass(ws, process.argv.slice(2))
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
      process.exit(summary.summary.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error(`Queue worker error: ${err.message}`);
      process.exit(2);
    });
}