import { strict as assert } from 'node:assert';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { TestWorkspace, makeEmployee, makeWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { upsertMcpServer } from '../../src/services/workforce/mcp/registry';
import {
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowLoopStep,
  WorkflowStep,
  WorkflowTaskStep,
  WorkflowToolStep
} from '../../src/data/types';
import { executeWorkflow } from '../../src/services/workforce/workflow/engine';
import { validateWorkflow } from '../../src/services/workforce/workflow/dsl';
import { planTitleFor } from '../../src/services/workforce/plan/planService';

function taskStep(id: string, title: string, overrides: Partial<WorkflowTaskStep> = {}): WorkflowTaskStep {
  return { id, type: 'task', title, taskType: 'chore', priority: 'low', backlog: 'features', ...overrides };
}

function toolStep(id: string, serverId: string, toolName: string, agent: string, overrides: Partial<WorkflowToolStep> = {}): WorkflowToolStep {
  return { id, type: 'tool', serverId, toolName, args: {}, agent, ...overrides };
}

function loopStep(id: string, maxIterations: number, body: WorkflowStep[]): WorkflowLoopStep {
  return { id, type: 'loop', maxIterations, iterateVar: 'i', body };
}

function conditionStep(id: string, when: WorkflowCondition, then: WorkflowStep[], els?: WorkflowStep[]) {
  return { id, type: 'condition' as const, when, then, else: els };
}

function workflow(id: string, steps: WorkflowStep[]): WorkflowDefinition {
  const now = new Date().toISOString();
  return { id, name: `Workflow ${id}`, version: '1.0.0', enabled: true, steps, createdAt: now, updatedAt: now };
}

function startMockMcp(body: unknown): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(text) as { id: number };
      const payload = body;
      const hasError = !!payload && typeof payload === 'object' && 'error' in (payload as object);
      const response = hasError
        ? { jsonrpc: '2.0', id: parsed.id, error: (payload as { error: unknown }).error }
        : { jsonrpc: '2.0', id: parsed.id, result: payload };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

describe('C7 workflow DSL', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('rejects a workflow with no steps', async () => {
    await assert.rejects(
      () => executeWorkflow(workflow('empty', []), { stores: getStores(ws.root) }),
      /must define at least one step/
    );
  });

  it('rejects duplicate step ids', async () => {
    const def = workflow('dup', [taskStep('same', 'A'), taskStep('same', 'B')]);
    await assert.rejects(
      () => executeWorkflow(def, { stores: getStores(ws.root) }),
      /duplicate step id 'same'/
    );
  });

  it('rejects unsupported step types', async () => {
    const def = workflow('bad-step', [{ id: 'x', type: 'explode' } as unknown as WorkflowStep]);
    await assert.rejects(
      () => executeWorkflow(def, { stores: getStores(ws.root) }),
      /unsupported step type 'explode'/
    );
  });

  it('rejects loops without a positive integer maxIterations', async () => {
    for (const max of [0, -1, 2.5]) {
      const def = workflow('loop-bad', [loopStep('l', max, [taskStep('a', 'A')])]);
      await assert.rejects(
        () => executeWorkflow(def, { stores: getStores(ws.root) }),
        /maxIterations/
      );
    }
  });

  it('rejects a tool step without an agent (authorization context is required)', async () => {
    const def = workflow('tool-noagent', [toolStep('t', 'web', 'list', 'Agent', { agent: '' })]);
    await assert.rejects(
      () => executeWorkflow(def, { stores: getStores(ws.root) }),
      /requires an agent/
    );
  });

  it('rejects a condition that references a step that does not exist', async () => {
    const def = workflow('cond-ghost', [
      conditionStep('c', { type: 'step-status', stepId: 'ghost', expectedStatus: 'completed' }, [taskStep('a', 'A')])
    ]);
    await assert.rejects(
      () => Promise.resolve().then(() => validateWorkflow(def)),
      /references unknown step 'ghost'/
    );
  });

  it('task steps create runnable plans and queued runs and persist workflow metadata', async () => {
    const def = workflow('wf-basic', [taskStep('one', 'First Task'), taskStep('two', 'Second Task')]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.stepResults.length, 2);
    assert.ok(result.stepResults.every(s => s.status === 'completed'));

    const plans = getStores(ws.root).plans.loadAll();
    assert.strictEqual(plans.length, 2);
    assert.ok(plans.every(p => p.source.inputId === 'synthetic:workflow:wf-basic'));
    assert.deepStrictEqual(plans.map(p => planTitleFor(p, ws.root)), ['First Task', 'Second Task']);
    assert.ok(plans.every(p => p.scheduling.status === 'ready' && p.execution.status === 'unassigned'));

    const runs = getStores(ws.root).runs.loadAll();
    assert.strictEqual(runs.length, 2);
    assert.ok(runs.every(r => r.status === 'queued'));
    assert.deepStrictEqual(runs.map(r => r.planId), plans.map(p => p.id));
  });

  it('executes steps in definition order', async () => {
    const def = workflow('wf-order', [
      taskStep('a', 'Alpha'),
      taskStep('b', 'Beta'),
      taskStep('c', 'Gamma')
    ]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.deepStrictEqual(result.stepResults.map(s => s.stepId), ['a', 'b', 'c']);
    assert.deepStrictEqual(
      getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)),
      ['Alpha', 'Beta', 'Gamma']
    );
  });

  it('never bypasses the queue: runs stay queued and no approval is requested', async () => {
    const def = workflow('wf-queue', [taskStep('a', 'Alpha')]);

    await executeWorkflow(def, { stores: getStores(ws.root) });

    const runs = getStores(ws.root).runs.loadAll();
    assert.ok(runs.length > 0);
    assert.ok(runs.every(r => r.status === 'queued'));
    assert.ok(runs.every(r => !r.startedAt));
    assert.strictEqual(getStores(ws.root).approvals.count(), 0);
    assert.strictEqual(getStores(ws.root).events.findByType('run.started').length, 0);
  });

  it('emits run.queued and workflow.completed events sourced as workflow', async () => {
    const def = workflow('wf-events', [taskStep('a', 'Alpha')]);

    await executeWorkflow(def, { stores: getStores(ws.root) });

    const queued = getStores(ws.root).events.findByType('run.queued');
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].source, 'workflow');
    assert.strictEqual(getStores(ws.root).events.findByType('workflow.completed').length, 1);
    assert.strictEqual(getStores(ws.root).events.findByType('workflow.failed').length, 0);
  });

  it('loops run a bounded number of times, terminate, and inject the iterate variable', async () => {
    const def = workflow('wf-loop', [loopStep('batch', 3, [taskStep('item', 'Batch Item {i}')])]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'completed');
    const loop = result.stepResults[0];
    assert.strictEqual(loop.status, 'completed');
    assert.strictEqual(loop.outputs.iterations, 3);
    assert.deepStrictEqual(
      getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)),
      ['Batch Item 0', 'Batch Item 1', 'Batch Item 2']
    );
  });

  it('loops abort immediately when a body step fails (bounded, no runaway)', async () => {
    const staff = makeEmployee({ name: 'Probe', role: 'agent', capabilities: ['mcp.web.boom'] });
    getStores(ws.root).people.add(staff);
    upsertMcpServer({ id: 'web', kind: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true });

    const def = workflow('wf-loop-fail', [loopStep('batch', 3, [toolStep('probe', 'web', 'boom', 'Probe')])]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.stepResults[0].status, 'failed');
    assert.strictEqual(result.stepResults[0].outputs.iterations, 1);
    assert.match(result.stepResults[0].error || '', /failed at iteration 0/);
  });

  it('conditions branch to then when a predecessor completed', async () => {
    const def = workflow('wf-cond-then', [
      taskStep('prep', 'Prep Task'),
      conditionStep(
        'pick',
        { type: 'step-status', stepId: 'prep', expectedStatus: 'completed' },
        [taskStep('thenTask', 'Then Task')],
        [taskStep('elseTask', 'Else Task')]
      )
    ]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.stepResults[1].outputs.branch, 'then');
    assert.deepStrictEqual(
      getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)),
      ['Prep Task', 'Then Task']
    );
  });

  it('failures are observable by conditions via continueOnError, enabling else branches', async () => {
    const staff = makeEmployee({ name: 'Probe', role: 'agent', capabilities: ['mcp.web.boom'] });
    getStores(ws.root).people.add(staff);
    upsertMcpServer({ id: 'web', kind: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true });

    const def = workflow('wf-cond-else', [
      toolStep('probe', 'web', 'boom', 'Probe', { continueOnError: true }),
      conditionStep(
        'pick',
        { type: 'step-status', stepId: 'probe', expectedStatus: 'completed' },
        [taskStep('thenTask', 'Should Not Run')],
        [taskStep('elseTask', 'Fallback Task')]
      )
    ]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.stepResults[0].status, 'failed');
    assert.strictEqual(result.stepResults[1].status, 'completed');
    assert.strictEqual(result.stepResults[1].outputs.branch, 'else');
    assert.deepStrictEqual(
      getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)),
      ['Fallback Task']
    );
  });

  it('static always/never conditions branch deterministically', async () => {
    const always = workflow('wf-always', [conditionStep('c', { type: 'always' }, [taskStep('a', 'Always Task')])]);
    const alwaysResult = await executeWorkflow(always, { stores: getStores(ws.root) });
    assert.strictEqual(alwaysResult.status, 'completed');
    assert.deepStrictEqual(getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)), ['Always Task']);

    const never = workflow('wf-never', [conditionStep('c', { type: 'never' }, [taskStep('a', 'Never Task')])]);
    const neverResult = await executeWorkflow(never, { stores: getStores(ws.root) });
    assert.strictEqual(neverResult.status, 'completed');
    assert.strictEqual(neverResult.stepResults[0].status, 'skipped');
    assert.strictEqual(getStores(ws.root).plans.loadAll().length, 1);
  });

  it('tool steps are denied by the MCP capability gate', async () => {
    const staff = makeEmployee({ name: 'Restricted', role: 'agent' });
    getStores(ws.root).people.add(staff);
    upsertMcpServer({ id: 'web', kind: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true });

    const def = workflow('wf-tool-deny', [toolStep('t', 'web', 'list', 'Restricted')]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.stepResults[0].status, 'failed');
    assert.match(result.stepResults[0].error || '', /lacks capability 'mcp\.web\.list'/);
  });

  it('tool steps pass the gate before the network call (outcome reflects the call)', async () => {
    const staff = makeEmployee({ name: 'Chained', role: 'agent', capabilities: ['mcp.web.list'] });
    getStores(ws.root).people.add(staff);
    upsertMcpServer({ id: 'web', kind: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true });

    const def = workflow('wf-tool-net', [toolStep('t', 'web', 'list', 'Chained')]);

    const result = await executeWorkflow(def, { stores: getStores(ws.root) });

    assert.strictEqual(result.status, 'failed');
    const error = result.stepResults[0].error || '';
    assert.match(error, /ECONNREFUSED|connection/);
    assert.ok(!/lacks capability/.test(error), 'capability gate must have passed');
  });

  it('successful tool calls record their output as data and never drive control flow', async () => {
    const mock = await startMockMcp({ content: [{ type: 'text', text: 'steal-this-secret' }] });
    try {
      const staff = makeEmployee({ name: 'ToolUser', role: 'agent', capabilities: ['mcp.web.fetch'] });
      getStores(ws.root).people.add(staff);
      upsertMcpServer({ id: 'web', kind: 'http', url: `http://127.0.0.1:${mock.port}/mcp`, enabled: true });

      const def = workflow('wf-tool-ok', [
        toolStep('fetch', 'web', 'fetch', 'ToolUser'),
        conditionStep(
          'after',
          { type: 'step-status', stepId: 'fetch', expectedStatus: 'completed' },
          [taskStep('next', 'Task After Tool')],
          [taskStep('fallback', 'Must Not Run')]
        )
      ]);

      const result = await executeWorkflow(def, { stores: getStores(ws.root) });

      assert.strictEqual(result.status, 'completed');
      const toolResult = result.stepResults[0];
      assert.strictEqual(toolResult.status, 'completed');
      assert.deepStrictEqual(toolResult.outputs.content, [{ type: 'text', text: 'steal-this-secret' }]);
      assert.strictEqual(toolResult.outputs.isError, false);
      assert.strictEqual(result.stepResults[1].outputs.branch, 'then');
      assert.deepStrictEqual(
        getStores(ws.root).plans.loadAll().map(p => planTitleFor(p, ws.root)),
        ['Task After Tool']
      );
    } finally {
      mock.server.close();
    }
  });

  it('stores and loads workflow definitions via WorkflowStore', async () => {
    const def = workflow('stored', [taskStep('a', 'Stored Task')]);
    getStores(ws.root).workflows.add(def);

    assert.strictEqual(getStores(ws.root).workflows.loadAll().length, 1);
    assert.strictEqual(getStores(ws.root).workflows.loadEnabled().length, 1);
    assert.strictEqual(getStores(ws.root).workflows.byId('stored')?.name, def.name);
    assert.strictEqual(getStores(ws.root).workflows.byName(def.name)?.id, 'stored');

    getStores(ws.root).workflows.update('stored', { enabled: false });
    assert.strictEqual(getStores(ws.root).workflows.loadEnabled().length, 0);
    assert.strictEqual(getStores(ws.root).workflows.byId('stored')?.enabled, false);
  });
});