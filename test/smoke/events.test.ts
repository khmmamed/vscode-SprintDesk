import { strict as assert } from 'node:assert';
import { makeWorkspace, makeTask, makeRun, makeEmployee, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { emitEvent } from '../../src/services/workforce/events';
import { startRun, finishRun, cancelRun, processQueue } from '../../src/services/workforce/queueService';
import { updateEmployee } from '../../src/services/workforce/workforceService';
import { getActivitySummary } from '../../src/services/workforce/observability';
import { executeRun } from '../../src/services/workforce/worker/worker';
import { Handler } from '../../src/mcp/handlers/helpers';
import { HANDLERS } from '../../src/mcp/handlers';

describe('workforce events + observability', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('emitEvent persists a typed event that EventStore.latest returns', () => {
    const event = emitEvent('test.ping', 'unit', { n: 1 });
    assert.ok(event.id);
    assert.strictEqual(event.type, 'test.ping');
    const latest = getStores().events.latest(10);
    assert.strictEqual(latest[0].id, event.id);
  });

  it('startRun emits run.started', () => {
    const employee = makeEmployee({ status: 'idle' });
    getStores().employees.add(employee);
    const task = makeTask({});
    const run = makeRun(task.id, employee.id);

    startRun(run.id);

    const started = getStores().events.latest(10).find(e => e.type === 'run.started');
    assert.ok(started, 'expected run.started event');
    assert.strictEqual(started.payload.runId, run.id);
    assert.strictEqual(started.payload.agentId, employee.id);
    assert.strictEqual(started.source, 'queue');
  });

  it('finishRun emits run.finished with status', () => {
    const employee = makeEmployee({});
    getStores().employees.add(employee);
    const task = makeTask({});
    const run = makeRun(task.id, employee.id);

    startRun(run.id);
    finishRun(run.id, { status: 'failed', error: 'boom' });

    const finished = getStores().events.latest(10).find(e => e.type === 'run.finished');
    assert.ok(finished);
    assert.strictEqual(finished.payload.status, 'failed');
    assert.strictEqual(finished.payload.runId, run.id);
  });

  it('cancelRun emits run.cancelled', () => {
    const employee = makeEmployee({ teamRole: 'lead' });
    getStores().employees.add(employee);
    const task = makeTask({});
    const run = makeRun(task.id, employee.id);

    cancelRun(run.id, employee.id);

    const cancelled = getStores().events.latest(10).find(e => e.type === 'run.cancelled');
    assert.ok(cancelled);
    assert.strictEqual(cancelled.payload.runId, run.id);
  });

  it('processQueue emits queue.skip with a reason', () => {
    const run = makeRun('ghost-task', 'ghost-agent');
    processQueue({ dryRun: false, limit: 1 });

    const skip = getStores().events.latest(10).find(e => e.type === 'queue.skip');
    assert.ok(skip);
    assert.strictEqual(skip.payload.runId, run.id);
    assert.strictEqual(skip.payload.reason, 'task-not-found');
  });

  it('updateEmployee emits employee.status only on actual status change', () => {
    const employee = makeEmployee({ status: 'idle' });
    getStores().employees.add(employee);

    updateEmployee(employee.id, { status: 'busy' });
    updateEmployee(employee.id, { status: 'busy' });

    const statusEvents = getStores()
      .events.latest(10)
      .filter(e => e.type === 'employee.status');
    assert.strictEqual(statusEvents.length, 1);
    assert.deepStrictEqual(
      { from: statusEvents[0].payload.from, to: statusEvents[0].payload.to },
      { from: 'idle', to: 'busy' }
    );
  });

  it('activity summary aggregates state and recent events', () => {
    const employee = makeEmployee({ status: 'busy', role: 'agent' });
    getStores().employees.add(employee);
    const human = makeEmployee({ status: 'offline', role: 'human' });
    getStores().employees.add(human);
    makeTask({});
    const run = makeRun(makeTask({}).id, employee.id);
    startRun(run.id);

    const summary = getActivitySummary(10);
    assert.strictEqual(summary.employees.total, 2);
    assert.strictEqual(summary.employees.busy, 1);
    assert.strictEqual(summary.employees.offline, 1);
    assert.strictEqual(summary.runs.running, 1);
    assert.strictEqual(summary.tasks.total, 2);
    assert.ok(summary.recentEvents.some(e => e.type === 'run.started'));
    assert.ok(summary.queue.maxConcurrentRuns >= 1);
  });

  it('sprintdesk_activitySummary handler is registered', async () => {
    const handler: Handler | undefined = HANDLERS['sprintdesk_activitySummary'];
    assert.ok(handler, 'handler registered');
    const result = await handler({});
    assert.strictEqual(result.isError, false);
    const text = result.content.map(c => c.text).join('\n');
    const parsed = JSON.parse(text);
    assert.ok('employees' in parsed && 'runs' in parsed && 'recentEvents' in parsed);
  });

  it('executeRun finishes a running run as failed when agent config is missing', async () => {
    const agent = makeEmployee({ status: 'idle', agentConfig: undefined });
    getStores().employees.add(agent);
    const task = makeTask({});
    const run = makeRun(task.id, agent.id);
    startRun(run.id);

    const result = await executeRun(run.id, 'noop');
    assert.strictEqual(result?.status, 'failed');
    assert.match(result?.error || '', /Agent not configured/);
    const stored = getStores().runs.getById(run.id);
    assert.strictEqual(stored?.status, 'failed');
    assert.strictEqual(getStores().employees.getById(agent.id)?.status, 'idle');
  });
});