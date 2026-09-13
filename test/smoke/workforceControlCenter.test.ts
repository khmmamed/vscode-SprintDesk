import { strict as assert } from 'node:assert';
import { makeEmployee, makeTask, makeRun, makeWorkspace, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import * as queueService from '../../src/services/workforce/queueService';
import { createOllamaWorker } from '../../src/services/workforce/worker/ollamaWorker';
import { getWorkerRuntime, executeRun, resolveRunnableState } from '../../src/services/workforce/worker/worker';
import { WorkerRequest } from '../../src/services/workforce/worker/worker';
import { setApprovalGate } from '../../src/services/workforce/gates';
import { LLMProvider } from '../../src/services/workforce/llm/types';

describe('queueService.createRun', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  it('creates a queued run and tags the task', () => {
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });

    const run = queueService.createRun(task.id, employee.id);

    assert.strictEqual(run.status, 'queued');
    assert.strictEqual(run.taskId, task.id);
    assert.strictEqual(run.agentId, employee.id);
    assert.strictEqual(getStores().runs.getById(run.id)?.id, run.id);
  });

  it('falls back to the task agent when no agent is given', () => {
    const employee = seedAgent({ name: 'Agent Alpha' });
    const task = makeTask({ type: 'feature', agent: employee.id });
    getStores().employees.add(makeEmployee());

    const run = queueService.createRun(task.id);
    assert.strictEqual(run.agentId, employee.id);
  });

  it('uses the task agent by code when taskId is a task code', () => {
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });
    getStores().employees.add(makeEmployee());

    const run = queueService.createRun(task.code, employee.id);
    assert.strictEqual(run.taskId, task.id);
    assert.strictEqual(run.agentId, employee.id);
  });

  it('rejects when the agent is not assigned', () => {
    const task = makeTask({ type: 'feature' });
    assert.throws(() => queueService.createRun(task.id, 'emp_missing'), /No agent assigned/);
  });

  it('rejects offline agents', () => {
    const employee = seedAgent({ status: 'offline' });
    const task = makeTask({ type: 'feature' });

    assert.throws(() => queueService.createRun(task.id, employee.id), /is offline/);
    assert.strictEqual(getStores().runs.loadAll().length, 0);
  });

  it('rejects agents without run:create permission', () => {
    const human = seedAgent({ role: 'human', teamRole: 'observer' });
    const task = makeTask({ type: 'feature' });

    assert.throws(() => queueService.createRun(task.id, human.id), /run:create/);
  });

  it('runs once end-to-end through the queue', async () => {
    const employee = seedAgent({ agentConfig: makeAgentConfig() });
    const task = makeTask({ type: 'feature' });

    const run = queueService.createRun(task.id, employee.id);
    const started = queueService.startRun(run.id);
    assert.strictEqual(started?.status, 'running');

    const result = await getWorkerRuntime('noop').run({
      run,
      task,
      employee,
      agentConfig: employee.agentConfig!,
      workspaceRoot: ws.root
    });
    assert.strictEqual(result.status, 'completed');
  });
});

describe('summarizeRunOutput / finishRun', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('counts bullet findings and errors from a sectioned output', () => {
    const summary = queueService.summarizeRunOutput(
      ['Findings:', '- first', '- second', '- third', 'Errors:', '- one failure'].join('\n')
    );
    assert.deepStrictEqual(summary, { findings: 3, errors: 1 });
  });

  it('treats "Errors: 0" as no errors', () => {
    const summary = queueService.summarizeRunOutput('Findings:\n- only one\nErrors:\n0');
    assert.deepStrictEqual(summary, { findings: 1, errors: 0 });
  });

  it('falls back to line counting without explicit sections', () => {
    const summary = queueService.summarizeRunOutput('\n- alpha\n - beta\n- ERROR: boom\n• gamma');
    assert.deepStrictEqual(summary, { findings: 3, errors: 1 });
  });

  it('flags a failed run with no output as a single error', () => {
    const summary = queueService.summarizeRunOutput('', 'process blew up', true);
    assert.deepStrictEqual(summary, { findings: 0, errors: 1 });
  });

  it('stores the summary on the run via finishRun', () => {
    const employee = makeEmployee();
    getStores().employees.add(employee);
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id);

    const started = queueService.startRun(run.id);
    assert.strictEqual(started?.status, 'running');

    queueService.finishRun(run.id, {
      status: 'completed',
      result: 'Findings:\n- a\n- b\nErrors:\n- 0'
    });

    const finished = getStores().runs.getById(run.id);
    assert.strictEqual(finished?.status, 'completed');
    assert.deepStrictEqual(finished?.summary, { findings: 2, errors: 0 });
  });
});

describe('ollama worker', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seededRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
    const employee = makeEmployee({ name: 'Morocco News Agent' });
    const task = makeTask({ title: 'Research Moroccan election news', type: 'feature' });
    const run = makeRun(task.id, employee.id);
    return {
      run,
      task,
      employee,
      agentConfig: makeAgentConfig({ tool: 'ollama', model: 'llama3' }),
      workspaceRoot: ws.root,
      ...overrides
    };
  }

  it('mode dispatch returns an ollama runtime', () => {
    assert.strictEqual(getWorkerRuntime('ollama').mode, 'ollama');
  });

  it('completes with the provider output', async () => {
    const fakeProvider: LLMProvider = {
      kind: 'ollama',
      chat: async () => ({ text: 'Findings:\n- a\nErrors:\n- 0' })
    };
    const result = await createOllamaWorker(fakeProvider).run(seededRequest());
    assert.strictEqual(result.status, 'completed');
    assert.ok((result.output || '').includes('Findings:'));
  });

  it('fails with invalid-config when no model is configured', async () => {
    const fakeProvider: LLMProvider = { kind: 'ollama', chat: async () => ({ text: 'x' }) };
    const result = await createOllamaWorker(fakeProvider).run(
      seededRequest({ agentConfig: makeAgentConfig({ tool: 'ollama', model: undefined }) })
    );
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.classification, 'invalid-config');
  });

  it('maps provider failures to a failed run', async () => {
    const failingProvider: LLMProvider = {
      kind: 'ollama',
      chat: async () => { throw new Error('connect ECONNREFUSED ::1:11434'); }
    };
    const result = await createOllamaWorker(failingProvider).run(seededRequest());
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.classification, 'spawn-error');
    assert.ok((result.error || '').includes('ECONNREFUSED'));
  });

  it('uses the employee model profile when present', async () => {
    let seenModel: string | undefined;
    const fakeProvider: LLMProvider = {
      kind: 'ollama',
      chat: async (req) => { seenModel = req.model; return { text: 'Findings:\n- a\nErrors:\n- 0' }; }
    };
    const request = seededRequest({
      modelProfile: { name: 'Morocco News Agent', provider: 'ollama', model: 'qwen2.5', baseUrl: 'http://localhost:11434' }
    });
    const result = await createOllamaWorker(fakeProvider).run(request);
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(seenModel, 'qwen2.5');
  });
});

describe('run lifecycle controls (control-center checklist)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function queuedRun(employeeId: string) {
    const task = makeTask({ type: 'feature' });
    const run = queueService.createRun(task.id, employeeId);
    return { task, run };
  }

  it('cancels a queued run and no-ops on a second cancel', () => {
    const employee = seedAgent();
    const { run } = queuedRun(employee.id);

    const cancelled = queueService.cancelRun(run.id, employee.id);
    assert.strictEqual(cancelled?.status, 'cancelled');
    assert.strictEqual(queueService.cancelRun(run.id, employee.id), undefined);
  });

  it('cancels a running run and frees the employee', () => {
    const employee = seedAgent({ agentConfig: makeAgentConfig() });
    const { run } = queuedRun(employee.id);
    queueService.startRun(run.id);
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'busy');

    const cancelled = queueService.cancelRun(run.id, employee.id);
    assert.strictEqual(cancelled?.status, 'cancelled');
    assert.strictEqual(getStores().employees.getById(employee.id)?.status, 'idle');
  });

  it('does not cancel a finished run', () => {
    const employee = seedAgent({ agentConfig: makeAgentConfig() });
    const { run } = queuedRun(employee.id);
    queueService.startRun(run.id);
    queueService.finishRun(run.id, { status: 'completed', result: 'done' });

    assert.strictEqual(queueService.cancelRun(run.id, employee.id), undefined);
    assert.strictEqual(getStores().runs.getById(run.id)?.status, 'completed');
  });

  it('leaves the run queued and requests approval when the run-execution gate is manual', () => {
    setApprovalGate('run-execution', 'manual');
    const employee = seedAgent();
    const { run } = queuedRun(employee.id);

    const started = queueService.startRun(run.id);
    assert.strictEqual(started, undefined);
    assert.strictEqual(getStores().runs.getById(run.id)?.status, 'queued');

    const pending = getStores().approvals.loadAll().filter(a => a.status === 'pending' && a.type === 'run-execution');
    assert.strictEqual(pending.length, 1);
    assert.deepStrictEqual(pending[0].pending, { op: 'start-run', runId: run.id, agentId: employee.id });
  });

  it('keeps findings from a findings section and reports zero errors for an "Errors: 0" section', () => {
    const summary = queueService.summarizeRunOutput('Findings:\n- a\n- ERROR: boom\nErrors:\n0');
    assert.deepStrictEqual(summary, { findings: 2, errors: 0 });
  });
});

describe('resolveRunnableState gate (configuration per mode)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('allows ollama runs with a modelProfile only (no agentConfig)', () => {
    const employee = makeEmployee({
      modelProfile: { name: 'MorElectra', provider: 'ollama', model: 'gemma4:31b-cloud', baseUrl: 'http://localhost:11434' }
    });
    assert.deepStrictEqual(resolveRunnableState(employee, 'ollama'), { ok: true });
  });

  it('allows ollama runs with agentConfig.model but no modelProfile', () => {
    const employee = makeEmployee({ agentConfig: makeAgentConfig({ tool: 'ollama', model: 'llama3' }) });
    assert.deepStrictEqual(resolveRunnableState(employee, 'ollama'), { ok: true });
  });

  it('allows ollama runs even when no model is configured (worker reports invalid-config)', () => {
    const employee = makeEmployee();
    assert.deepStrictEqual(resolveRunnableState(employee, 'ollama'), { ok: true });
  });

  it('rejects noop, terminal and headless runs without agentConfig', () => {
    const employee = makeEmployee();
    for (const mode of ['noop', 'terminal', 'headless'] as const) {
      const state = resolveRunnableState(employee, mode);
      assert.strictEqual(state.ok, false);
      if (!state.ok) {assert.match(state.error, /agentConfig\.tool/);}
    }
  });

  it('allows noop runs when agentConfig is present', () => {
    const employee = makeEmployee({ agentConfig: makeAgentConfig() });
    assert.deepStrictEqual(resolveRunnableState(employee, 'noop'), { ok: true });
  });
});

describe('ollama end-to-end against a local model', () => {
  const enabled = process.env.SPRINTDESK_OLLAMA_E2E === '1';
  const model = process.env.SPRINTDESK_OLLAMA_MODEL || 'gemma4:31b-cloud';

  let ws: TestWorkspace;

  before(function () {
    if (!enabled) {this.skip();}
  });

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('runs a real task through createRun → startRun → executeRun → finishRun', async function () {
    this.timeout(180000);
    const employee = makeEmployee({
      name: 'Morocco News Agent',
      modelProfile: { name: 'Morocco News Agent', provider: 'ollama', model, baseUrl: 'http://localhost:11434' }
    });
    getStores().employees.add(employee);
    const task = makeTask({ title: 'Research Moroccan election news and summarize the key parties and dates', type: 'feature' });

    const run = queueService.createRun(task.id, employee.id);
    const started = queueService.startRun(run.id);
    assert.strictEqual(started?.status, 'running');

    const result = await executeRun(run.id, 'ollama');
    const finished = getStores().runs.getById(run.id);
    console.log('OLLAMA OUTPUT:\n' + (result?.output || '<none>') + '\n--- summary: ' + JSON.stringify(finished?.summary));

    assert.strictEqual(result?.status, 'completed');
    assert.ok((result?.output || '').trim().length > 0);
    assert.strictEqual(finished?.status, 'completed');
    assert.ok(finished?.summary, 'finishRun must write a summary');
  });
});
