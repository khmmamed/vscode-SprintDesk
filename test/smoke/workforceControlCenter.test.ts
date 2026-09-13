import { strict as assert } from 'node:assert';
import { makeEmployee, makeTask, makeRun, makeWorkspace, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import * as queueService from '../../src/services/workforce/queueService';
import * as findingsService from '../../src/services/workforce/findingsService';
import * as workforceService from '../../src/services/workforce/workforceService';
import * as approvals from '../../src/services/workforce/approvals';
import * as eventRulesService from '../../src/services/workforce/eventRulesService';
import { emitEvent } from '../../src/services/workforce/events';
import { getDataService } from '../../src/data/DataService';
import { EventRecord, WorkflowDefinition } from '../../src/data/types';
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

describe('findings (first-class workforce objects, v0.11)', () => {
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

  it('extracts bullets and severities from a Findings section', () => {
    const bullets = findingsService.extractFindingBullets(
      ['Findings:', '- [high] candidate announcement', '- scheduled event', '3. poll results', 'Errors:', '- some failure'].join('\n')
    );
    assert.deepStrictEqual(bullets, [
      { title: 'candidate announcement', severity: 'high' },
      { title: 'scheduled event', severity: 'medium' },
      { title: 'poll results', severity: 'medium' }
    ]);
  });

  it('returns nothing when there is no Findings section', () => {
    assert.deepStrictEqual(findingsService.extractFindingBullets('- alpha\n- beta'), []);
  });

  it('materializes pending findings attributed to the run and agent', () => {
    const employee = seedAgent({ name: 'Morocco News Agent' });
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id, { result: 'Findings:\n- a\n- b\nErrors:\n0' });

    const created = findingsService.materializeFindings(run.id);
    assert.strictEqual(created.length, 2);

    const stored = findingsService.allFindings();
    assert.strictEqual(stored.length, 2);
    assert.ok(stored.every(f => f.status === 'pending'));
    assert.ok(stored.every(f => f.source.runId === run.id));
    assert.ok(stored.every(f => f.agent === employee.id && f.agentName === 'Morocco News Agent'));
    assert.ok(stored.every(f => f.taskId === task.id));
  });

  it('does not duplicate findings when re-materializing with reordered bullets', () => {
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id, { result: 'Findings:\n- alpha\n- beta\n- gamma\nErrors:\n0' });

    findingsService.materializeFindings(run.id);
    assert.strictEqual(findingsService.allFindings().length, 3);

    getStores().runs.update(run.id, { result: 'Findings:\n- gamma\n- alpha\n- beta\nErrors:\n0' });
    findingsService.materializeFindings(run.id);
    assert.strictEqual(findingsService.allFindings().length, 3);
  });

  it('materializes findings when a run finishes through finishRun', () => {
    const employee = seedAgent({ agentConfig: makeAgentConfig() });
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id);

    queueService.startRun(run.id);
    queueService.finishRun(run.id, { status: 'completed', result: 'Findings:\n- verified claim\nErrors:\n0' });

    const stored = findingsService.allFindings();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].title, 'verified claim');
    assert.strictEqual(stored[0].source.runId, run.id);

    const createdEvents = getStores().events.findByType('finding.created');
    assert.strictEqual(createdEvents.length, 1);
    assert.strictEqual(createdEvents[0].payload.runId, run.id);
  });

  it('approves and rejects pending findings and emits finding.resolved only once', () => {
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id, { result: 'Findings:\n- a\nErrors:\n0' });

    const [finding] = findingsService.materializeFindings(run.id);
    assert.strictEqual(finding.status, 'pending');

    const approved = findingsService.updateStatus(finding.id, 'approved');
    assert.strictEqual(approved?.status, 'approved');
    assert.ok(approved?.resolvedAt);
    assert.strictEqual(findingsService.updateStatus(finding.id, 'rejected'), undefined);

    const resolvedEvents = getStores().events.findByType('finding.resolved');
    assert.strictEqual(resolvedEvents.length, 1);
    assert.strictEqual(resolvedEvents[0].payload.status, 'approved');
  });

  it('blocks approval decisions for actors without approval:review permission', () => {
    const observer = seedAgent({ role: 'human', teamRole: 'observer' });
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id, { result: 'Findings:\n- a\nErrors:\n0' });
    const [finding] = findingsService.materializeFindings(run.id);

    assert.throws(() => findingsService.updateStatus(finding.id, 'approved', observer.id), /approval:review/);
    assert.strictEqual(getStores().findings.getById(finding.id)?.status, 'pending');

    const reviewer = seedAgent({ role: 'human', teamRole: 'human' });
    const rejected = findingsService.updateStatus(finding.id, 'rejected', reviewer.id);
    assert.strictEqual(rejected?.status, 'rejected');
    assert.strictEqual(rejected?.decisionBy, reviewer.id);
  });
});

describe('applyConfigChange (agent model/configuration, v0.11)', () => {
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

  it('applies model, tool and capabilities when the config-change gate is auto', () => {
    const employee = seedAgent();
    const result = workforceService.applyConfigChange(employee.id, {
      modelProfile: { name: 'Agent Alpha', provider: 'ollama', model: 'gemma4:31b-cloud', baseUrl: 'http://localhost:11434' },
      agentConfig: { tool: 'ollama' },
      capabilities: ['web-search', 'news']
    });

    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.approvalRequired, undefined);

    const stored = getStores().employees.getById(employee.id);
    assert.strictEqual(stored?.modelProfile?.provider, 'ollama');
    assert.strictEqual(stored?.modelProfile?.model, 'gemma4:31b-cloud');
    assert.strictEqual(stored?.modelProfile?.baseUrl, 'http://localhost:11434');
    assert.strictEqual(stored?.agentConfig?.tool, 'ollama');
    assert.deepStrictEqual(stored?.capabilities, ['web-search', 'news']);
    assert.strictEqual(getStores().approvals.loadAll().length, 0);
  });

  it('requests an approval instead of applying when the config-change gate is manual', () => {
    setApprovalGate('config-change', 'manual');
    const employee = seedAgent();
    const result = workforceService.applyConfigChange(employee.id, {
      modelProfile: { name: employee.name, provider: 'ollama', model: 'qwen2.5' }
    });

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.approvalRequired, true);
    assert.strictEqual(getStores().employees.getById(employee.id)?.modelProfile, undefined);

    const pending = getStores().approvals.loadAll().filter(a => a.status === 'pending' && a.type === 'config-change');
    assert.strictEqual(pending.length, 1);
    assert.deepStrictEqual(pending[0].pending, {
      op: 'apply-config',
      employeeId: employee.id,
      changes: { modelProfile: { name: employee.name, provider: 'ollama', model: 'qwen2.5' } }
    });
  });

  it('applies a pending config change when the approval is resolved approved', () => {
    setApprovalGate('config-change', 'manual');
    const employee = seedAgent();
    workforceService.applyConfigChange(employee.id, { agentConfig: { tool: 'opencode' } });

    const pending = getStores().approvals.loadAll().filter(a => a.type === 'config-change' && a.status === 'pending');
    assert.strictEqual(pending.length, 1);

    const approved = approvals.resolveApproval(pending[0].id, 'approved');
    assert.strictEqual(approved?.status, 'approved');
    assert.strictEqual(getStores().employees.getById(employee.id)?.agentConfig?.tool, 'opencode');
  });

  it('throws for a missing employee', () => {
    assert.throws(() => workforceService.applyConfigChange('emp_nope', { capabilities: ['x'] }), /not found/);
  });
});

describe('event rules (async automation, v0.11)', () => {
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

  function makeWorkflow(id: string, title: string): WorkflowDefinition {
    const now = new Date().toISOString();
    const wf: WorkflowDefinition = {
      id,
      name: `Workflow ${id}`,
      version: '1.0.0',
      enabled: true,
      steps: [{ id: 's1', type: 'task', title, taskType: 'chore', priority: 'low', backlog: 'features' }],
      createdAt: now,
      updatedAt: now
    };
    getStores().workflows.add(wf);
    return wf;
  }

  function makeEvent(type = 'custom.event', source = 'test', payload: Record<string, unknown> = {}): EventRecord {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source,
      payload,
      timestamp: new Date().toISOString()
    };
  }

  it('matches events on type, source and payload conditions', () => {
    const wf = makeWorkflow('wf-triage', 'Triage');
    const rule = eventRulesService.createEventRule({
      name: 'PR merged',
      matcher: { eventType: 'pull_request.merged', source: 'github', payloadKey: 'repo.name', payloadValue: 'morocco-news' },
      workflowId: wf.id
    });

    assert.strictEqual(eventRulesService.ruleMatches(rule, makeEvent('pull_request.merged', 'github', { repo: { name: 'morocco-news' } })), true);
    assert.strictEqual(eventRulesService.ruleMatches(rule, makeEvent('pull_request.closed', 'github', { repo: { name: 'morocco-news' } })), false);
    assert.strictEqual(eventRulesService.ruleMatches(rule, makeEvent('pull_request.merged', 'github', { repo: { name: 'other' } })), false);
    assert.strictEqual(eventRulesService.ruleMatches(rule, makeEvent('pull_request.merged', 'gitlab', { repo: { name: 'morocco-news' } })), false);
  });

  it('matches with a key-only payload condition and an empty matcher', () => {
    const wf = makeWorkflow('wf-any', 'Any');
    const keyRule = eventRulesService.createEventRule({
      name: 'has-task',
      matcher: { eventType: 'run.finished', payloadKey: 'taskId' },
      workflowId: wf.id
    });
    assert.strictEqual(eventRulesService.ruleMatches(keyRule, makeEvent('run.finished', 'worker', { taskId: 'task_1' })), true);
    assert.strictEqual(eventRulesService.ruleMatches(keyRule, makeEvent('run.finished', 'worker', { other: 1 })), false);

    const anyRule = eventRulesService.createEventRule({ name: 'any', matcher: {}, workflowId: wf.id });
    assert.strictEqual(eventRulesService.ruleMatches(anyRule, makeEvent('whatever', 'whoever', { x: 1 })), true);
  });

  it('triggers the workflow for a matching event and records the occasion', async () => {
    const wf = makeWorkflow('wf-news', 'News Briefing');
    const rule = eventRulesService.createEventRule({
      name: 'PR merged to news agent',
      matcher: { eventType: 'pull_request.merged', source: 'github' },
      workflowId: wf.id
    });

    const event = makeEvent('pull_request.merged', 'github', { repo: { name: 'morocco-news' } });
    const results = await eventRulesService.processEventRules(event);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].matched, true);
    assert.strictEqual(results[0].triggered, true);
    assert.strictEqual(results[0].status, 'completed');
    assert.strictEqual(results[0].createdTaskIds?.length, 1);

    const stored = getStores().eventRules.getById(rule.id);
    assert.strictEqual(stored?.runCount, 1);
    assert.strictEqual(stored?.lastEventId, event.id);
    assert.ok(stored?.lastTriggeredAt);
    assert.strictEqual(stored?.recentTriggers[0]?.eventId, event.id);
    assert.strictEqual(stored?.recentTriggers[0]?.status, 'completed');
    assert.strictEqual(stored?.recentTriggers[0]?.createdTaskIds?.length, 1);
    assert.strictEqual(getDataService().loadTasks().length, 1);
    assert.strictEqual(getStores().runs.loadAll().length, 1);
    assert.strictEqual(getStores().events.findByType('eventrule.fired').length, 1);
  });

  it('does not trigger for a non-matching event', async () => {
    const wf = makeWorkflow('wf-nomatch', 'No');
    const rule = eventRulesService.createEventRule({ name: 'Only PRs', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });

    const results = await eventRulesService.processEventRules(makeEvent('push', 'github', {}));

    assert.strictEqual(results[0]?.skipReason, 'non-matching');
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.runCount, 0);
    assert.strictEqual(getDataService().loadTasks().length, 0);
  });

  it('ignores disabled rules', async () => {
    const wf = makeWorkflow('wf-off', 'Off');
    const rule = eventRulesService.createEventRule({ name: 'Off rule', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });
    eventRulesService.setEventRuleEnabled(rule.id, false);

    const results = await eventRulesService.processEventRules(makeEvent('pull_request.merged', 'github', {}));

    assert.strictEqual(results[0]?.skipReason, 'disabled');
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.runCount, 0);
  });

  it('is idempotent: one trigger per event', async () => {
    const wf = makeWorkflow('wf-idem', 'Idem');
    const rule = eventRulesService.createEventRule({ name: 'Once', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });
    const event = makeEvent('pull_request.merged', 'github', {});

    await eventRulesService.processEventRules(event);
    const second = await eventRulesService.processEventRules(event);

    assert.strictEqual(second[0]?.matched, true);
    assert.strictEqual(second[0]?.skipReason, 'already-triggered');
    assert.strictEqual(second[0]?.triggered, false);
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.runCount, 1);
    assert.strictEqual(getStores().runs.loadAll().length, 1);
  });

  it('re-entrancy guard: events emitted while a rule runs do not re-evaluate rules', async () => {
    const wf = makeWorkflow('wf-loopguard', 'Loop Guard');
    eventRulesService.createEventRule({ name: 'Queue watcher', matcher: { eventType: 'run.queued' }, workflowId: wf.id });

    const results = await eventRulesService.processEventRules(makeEvent('run.queued', 'worker', { taskId: 'task_x' }));

    assert.strictEqual(getStores().eventRules.loadAll()[0]?.runCount, 1);
    assert.strictEqual(getStores().runs.loadAll().length, 1);
    assert.strictEqual(results.length, 1);
  });

  it('wires rules into emitEvent automatically', async () => {
    const wf = makeWorkflow('wf-auto', 'Auto');
    eventRulesService.createEventRule({ name: 'PR merged', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });

    emitEvent('pull_request.merged', 'github', { repo: { name: 'morocco-news' } });
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.strictEqual(getStores().eventRules.loadAll()[0]?.runCount, 1);
    assert.strictEqual(getStores().runs.loadAll().length, 1);
  });

  it('records audit events for creation, triggering and disable', async () => {
    const wf = makeWorkflow('wf-audit', 'Audit');
    const rule = eventRulesService.createEventRule({ name: 'Audited', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });

    const event = makeEvent('pull_request.merged', 'github', {});
    await eventRulesService.processEventRules(event);
    eventRulesService.setEventRuleEnabled(rule.id, false);

    const actions = getStores().audit.loadAll().map(a => a.action).filter(a => a.startsWith('eventrule'));
    assert.deepStrictEqual(actions, ['eventrule.created', 'eventrule.triggered', 'eventrule.disabled']);
  });

  it('records a failed trigger and does not crash when the workflow is missing', async () => {
    const wf = makeWorkflow('wf-gone', 'Gone');
    const rule = eventRulesService.createEventRule({ name: 'Ghost', matcher: { eventType: 'pull_request.merged' }, workflowId: wf.id });
    getStores().workflows.delete(wf.id);

    const results = await eventRulesService.processEventRules(makeEvent('pull_request.merged', 'github', {}));

    assert.strictEqual(results[0]?.triggered, true);
    assert.strictEqual(results[0]?.status, 'failed');
    assert.match(results[0]?.error || '', /not found/);
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.recentTriggers[0]?.status, 'failed');
  });

  it('requires event-rule:manage to create, toggle and delete rules', () => {
    const wf = makeWorkflow('wf-perm', 'Perm');
    const agent = seedAgent({ role: 'agent', teamRole: 'agent', name: 'No Rights' });
    const observer = seedAgent({ role: 'human', teamRole: 'observer', name: 'Observer' });

    assert.throws(() => eventRulesService.createEventRule({ name: 'x', matcher: {}, workflowId: wf.id }, agent.id), /event-rule:manage/);
    assert.throws(() => eventRulesService.createEventRule({ name: 'x', matcher: {}, workflowId: wf.id }, observer.id), /event-rule:manage/);

    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead' });
    const rule = eventRulesService.createEventRule({ name: 'Allowed', matcher: {}, workflowId: wf.id }, lead.id);
    assert.strictEqual(rule.name, 'Allowed');

    assert.throws(() => eventRulesService.setEventRuleEnabled(rule.id, false, agent.id), /event-rule:manage/);
    assert.throws(() => eventRulesService.deleteEventRule(rule.id, observer.id), /event-rule:manage/);
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.enabled, true);
  });

  it('rejects creation for a missing workflow and supports update, toggle and delete', () => {
    assert.throws(
      () => eventRulesService.createEventRule({ name: 'x', matcher: {}, workflowId: 'wf_nope' }),
      /Workflow 'wf_nope' not found/
    );

    const wf = makeWorkflow('wf-upd', 'Upd');
    const rule = eventRulesService.createEventRule({ name: 'Old name', matcher: { eventType: 'a' }, workflowId: wf.id });

    const updated = eventRulesService.updateEventRule(rule.id, { name: 'New name', matcher: { eventType: 'b', source: 'github' } });
    assert.strictEqual(updated.name, 'New name');
    assert.deepStrictEqual(updated.matcher, { eventType: 'b', source: 'github' });

    const toggled = eventRulesService.setEventRuleEnabled(rule.id, false);
    assert.strictEqual(toggled.enabled, false);

    const deleted = eventRulesService.deleteEventRule(rule.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(getStores().eventRules.getById(rule.id), undefined);
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
