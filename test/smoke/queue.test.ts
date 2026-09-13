import { strict as assert } from 'node:assert';
import { makeEmployee, makeTask, makeRun, makeWorkspace, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { getDataService } from '../../src/data/DataService';
import * as worker from '../../src/services/workforce/worker/worker';
import * as queueService from '../../src/services/workforce/queueService';

function seedSkilledAgent(skills: string[]) {
  getStores().skills.seedDefaultSkills();
  const employee = makeEmployee({
    skills: skills.map(name => ({ name, level: 1 as const })),
    agentConfig: makeAgentConfig()
  });
  getStores().employees.add(employee);
  return employee;
}

describe('queueService headless loop', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    queueService.updateQueueSettings({ workerMode: 'noop', maxConcurrentRuns: 2 });
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('runs a queued run to completion: run completed, employee idle, task done', async () => {
    const employee = seedSkilledAgent(['typescript', 'vscode-extension', 'apis']);
    const task = makeTask({ type: 'feature' });
    makeRun(task.id, employee.id);

    const pass = await worker.runQueuePass({ mode: 'noop' });

    assert.deepStrictEqual(pass.skipped, []);
    assert.strictEqual(pass.executed.length, 1);

    const run = getStores().runs.getById(pass.executed[0].runId);
    assert.strictEqual(run?.status, 'completed');
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'idle');
    assert.strictEqual(getDataService(ws.root).getTask(task.id)?.workStatus, 'done');
  });

  it('does not claim runs for offline employees', async () => {
    const employee = seedSkilledAgent(['typescript', 'vscode-extension', 'apis']);
    getStores().employees.update(employee.id, { status: 'offline' });
    const task = makeTask({ type: 'feature' });
    makeRun(task.id, employee.id);

    const pass = await worker.runQueuePass({ mode: 'noop' });

    assert.strictEqual(pass.executed.length, 0);
    assert.strictEqual(pass.skipped.length, 1);
    assert.strictEqual(pass.skipped[0].reason, 'employee-offline');
    assert.strictEqual(getStores().runs.getById(pass.skipped[0].runId)?.status, 'queued');
  });

  it('does not claim a run whose task is already closed', async () => {
    const employee = seedSkilledAgent(['typescript', 'vscode-extension', 'apis']);
    const task = makeTask({ type: 'feature', status: 'done' });
    makeRun(task.id, employee.id);

    const pass = await worker.runQueuePass({ mode: 'noop' });

    assert.strictEqual(pass.executed.length, 0);
    assert.strictEqual(pass.skipped[0].reason, 'task-closed');
  });

  it('respects global capacity across passes', async () => {
    queueService.updateQueueSettings({ workerMode: 'noop', maxConcurrentRuns: 1 });
    const employee = seedSkilledAgent(['typescript', 'vscode-extension', 'apis']);
    const taskA = makeTask({ type: 'feature' });
    const taskB = makeTask({ type: 'feature' });
    makeRun(taskA.id, employee.id);
    makeRun(taskB.id, employee.id);

    const first = await worker.runQueuePass({ mode: 'noop' });
    assert.strictEqual(first.executed.length, 1);

    const remaining = getStores().runs.loadAll().filter(r => r.status === 'queued');
    assert.strictEqual(remaining.length, 1);

    const second = await worker.runQueuePass({ mode: 'noop' });
    assert.strictEqual(second.executed.length, 1);
    assert.strictEqual(getStores().runs.loadAll().filter(r => r.status === 'completed').length, 2);
  });

  it('executeRun ignores runs that are still queued', async () => {
    const employee = seedSkilledAgent(['typescript', 'vscode-extension', 'apis']);
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id);

    const result = await worker.executeRun(run.id, 'noop');
    assert.strictEqual(result, undefined);
    assert.strictEqual(getStores().runs.getById(run.id)?.status, 'queued');
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'idle');

    const started = queueService.startRun(run.id);
    assert.strictEqual(started?.status, 'running');
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'busy');

    const direct = await worker.executeRun(run.id, 'noop');
    assert.strictEqual(direct?.status, 'completed');
    assert.strictEqual(getStores().runs.getById(run.id)?.status, 'completed');
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'idle');
    assert.strictEqual(getDataService(ws.root).getTask(task.id)?.workStatus, 'done');
  });
});