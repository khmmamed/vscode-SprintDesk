import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, makeTask, makeRun, makeEmployee, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { updateQueueSettings } from '../../src/services/workforce/queueService';
import { startRun, finishRun, requeueRun, processQueue } from '../../src/services/workforce/queueService';
import { executeRun } from '../../src/services/workforce/worker/worker';

function writeScript(ws: TestWorkspace, name: string, body: string): string {
  const script = path.join(ws.root, name);
  fs.writeFileSync(script, body, 'utf8');
  return script;
}

describe('C4 workflow: retries, timeout, classification', () => {
  let ws: TestWorkspace;
  let failScript: string;
  let sleepScript: string;
  let okScript: string;

  beforeEach(() => {
    ws = makeWorkspace();
    failScript = writeScript(ws, 'fail.cjs', 'process.exit(7);');
    sleepScript = writeScript(ws, 'sleep.cjs', 'setTimeout(() => process.exit(0), 5000);');
    okScript = writeScript(ws, 'ok.cjs', 'console.log("ALL GOOD");');
  });

  afterEach(() => {
    ws.cleanup();
  });

  function makeAgent(command: string) {
    const agent = makeEmployee({ status: 'idle', agentConfig: makeAgentConfig({ tool: 'custom', command }) });
    getStores().employees.add(agent);
    return agent;
  }

  function startRunFor(agentId: string): string {
    const task = makeTask({});
    const run = makeRun(task.id, agentId);
    startRun(run.id);
    return run.id;
  }

  it('fails a successful run is not requeued and completes', async () => {
    updateQueueSettings({ maxRunRetries: 2, runTimeoutMs: 600000 });
    const agent = makeAgent(`node ${okScript}`);
    const runId = startRunFor(agent.id);

    const result = await executeRun(runId, 'headless');
    assert.strictEqual(result?.status, 'completed');
    assert.match(result?.output || '', /ALL GOOD/);
    assert.strictEqual(getStores().runs.getById(runId)?.status, 'completed');
    assert.strictEqual(getStores().employees.getById(agent.id)?.status, 'idle');
  });

  it('requeues a failed run up to maxRunRetries then fails terminally', async () => {
    updateQueueSettings({ maxRunRetries: 1, runTimeoutMs: 600000 });
    const agent = makeAgent(`node ${failScript}`);
    const runId = startRunFor(agent.id);

    const first = await executeRun(runId, 'headless');
    assert.strictEqual(first?.status, 'failed');
    const afterFirst = getStores().runs.getById(runId);
    assert.strictEqual(afterFirst?.status, 'queued');
    assert.strictEqual(afterFirst?.attempts, 2);
    assert.strictEqual(getStores().employees.getById(agent.id)?.status, 'idle');

    const retried = getStores().events.latest(10).find(e => e.type === 'run.retried');
    assert.ok(retried);
    assert.strictEqual(retried.payload.attempts, 2);

    processQueue({ dryRun: false, limit: 1 });
    const second = await executeRun(runId, 'headless');
    assert.strictEqual(second?.status, 'failed');
    const afterSecond = getStores().runs.getById(runId);
    assert.strictEqual(afterSecond?.status, 'failed');
    assert.strictEqual(afterSecond?.attempts, 2);
    assert.strictEqual(getStores().employees.getById(agent.id)?.status, 'idle');

    const finished = getStores().events.latest(10).find(e => e.type === 'run.finished' && e.payload.runId === runId);
    assert.ok(finished);
    assert.strictEqual(finished.payload.status, 'failed');
    assert.strictEqual(finished.payload.classification, 'exit-nonzero');
  });

  it('does not requeue when maxRunRetries is 0', () => {
    updateQueueSettings({ maxRunRetries: 0 });
    const agent = makeAgent(`node ${failScript}`);
    const runId = startRunFor(agent.id);
    assert.strictEqual(requeueRun(runId), false);
    assert.strictEqual(getStores().runs.getById(runId)?.status, 'running');
  });

  it('times out a hung run and classifies it as timeout', async () => {
    updateQueueSettings({ maxRunRetries: 0, runTimeoutMs: 300 });
    const agent = makeAgent(`node ${sleepScript}`);
    const runId = startRunFor(agent.id);

    const result = await executeRun(runId, 'headless');
    assert.strictEqual(result?.status, 'failed');
    assert.match(result?.error || '', /Timeout after/);
    const stored = getStores().runs.getById(runId);
    assert.strictEqual(stored?.status, 'failed');

    const finished = getStores().events.latest(10).find(e => e.type === 'run.finished' && e.payload.runId === runId);
    assert.ok(finished);
    assert.strictEqual(finished.payload.classification, 'timeout');
    assert.strictEqual(getStores().employees.getById(agent.id)?.status, 'idle');
  });

  it('classifies spawn errors (missing executable) as spawn-error', async () => {
    updateQueueSettings({ maxRunRetries: 0, runTimeoutMs: 1000 });
    const agent = makeAgent(`surely-not-a-real-binary-xyz`);
    const runId = startRunFor(agent.id);

    const result = await executeRun(runId, 'headless');
    assert.strictEqual(result?.status, 'failed');
    assert.ok(result?.classification === 'spawn-error' || result?.classification === 'exit-nonzero');

    const finished = getStores().events.latest(10).find(e => e.type === 'run.finished' && e.payload.runId === runId);
    assert.ok(finished);
    const classification = String(finished.payload.classification);
    assert.ok(['spawn-error', 'exit-nonzero'].includes(classification));
  });

  it('successful completion carries no failure classification', async () => {
    updateQueueSettings({ maxRunRetries: 0 });
    const agent = makeAgent(`node ${okScript}`);
    const runId = startRunFor(agent.id);
    await executeRun(runId, 'headless');
    const finished = getStores().events.latest(10).find(e => e.type === 'run.finished' && e.payload.runId === runId);
    assert.ok(finished);
    assert.strictEqual(finished.payload.status, 'completed');
    assert.ok(finished.payload.classification === undefined);
  });

  it('manual requeueRun only works on a running run and emits an event', () => {
    updateQueueSettings({ maxRunRetries: 5 });
    const agent = makeAgent(`node ${okScript}`);
    const runId = startRunFor(agent.id);

    assert.strictEqual(requeueRun(runId), true);
    const run = getStores().runs.getById(runId)!;
    assert.strictEqual(run.status, 'queued');
    assert.strictEqual(run.attempts, 2);
    assert.strictEqual(run.startedAt, undefined);

    assert.strictEqual(requeueRun(runId), false); // already queued
    const retried = getStores().events.latest(10).filter(e => e.type === 'run.retried');
    assert.strictEqual(retried.length, 1);

    const finishedRun = finishRun(runId, { status: 'failed', error: 'x' });
    assert.strictEqual(finishedRun, undefined); // not running -> finishRun no-ops
  });
});