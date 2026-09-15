import { strict as assert } from 'node:assert';
import { makeEmployee, makeTask, makeRun, makeWorkspace, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import * as queueService from '../../src/services/workforce/queueService';
import * as findingsService from '../../src/services/workforce/findingsService';
import * as workforceService from '../../src/services/workforce/workforceService';
import * as taskService from '../../src/services/taskService';
import * as approvals from '../../src/services/workforce/approvals';
import * as classificationService from '../../src/services/workforce/classification/classificationService';
import { classifyFinding } from '../../src/services/workforce/worker/classifier';
import * as eventRulesService from '../../src/services/workforce/eventRulesService';
import { emitEvent } from '../../src/services/workforce/events';
import { getRunsByFilter, runDetail, getQueueSnapshot, getActivitySummary, getExecutionWindowReport } from '../../src/services/workforce/observability';
import * as executionWindowService from '../../src/services/workforce/executionWindowService';
import { getDataService } from '../../src/data/DataService';
import { EventRecord, WorkflowDefinition, ScheduleRecord } from '../../src/data/types';
import { createOllamaWorker } from '../../src/services/workforce/worker/ollamaWorker';
import { getWorkerRuntime, executeRun, resolveRunnableState } from '../../src/services/workforce/worker/worker';
import { WorkerRequest } from '../../src/services/workforce/worker/worker';
import { setApprovalGate, requestApproval } from '../../src/services/workforce/gates';
import { runSchedulerPass } from '../../src/services/workforce/scheduler/scheduler';
import { ChatMessage, LLMProvider } from '../../src/services/workforce/llm/types';

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

describe('agent validation & review (v0.11)', () => {
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

  function materializeOne(result = 'Findings:\n- a claim\nErrors:\n0') {
    const employee = seedAgent();
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, employee.id, { result });
    return findingsService.materializeFindings(run.id)[0];
  }

  it('enters the agent-review state when a finding is created', () => {
    const finding = materializeOne();
    assert.strictEqual(finding.agentValidationState, 'requested');
    assert.ok(finding.agentValidationRequestedAt);
    assert.strictEqual(finding.status, 'pending');

    const requested = getStores().events.findByType('finding.validation.requested');
    assert.strictEqual(requested.length, 1);
    assert.strictEqual(requested[0].payload.findingId, finding.id);
  });

  it('lets an authorized validator record a recommendation without deciding the finding', () => {
    const finding = materializeOne();
    const validator = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Review Bot' });

    const validated = findingsService.validateFinding(
      finding.id,
      { recommendation: 'recommend-approve', confidence: 0.9, reason: 'matches scope' },
      validator.id
    );

    assert.strictEqual(validated?.agentValidationState, 'validated');
    assert.strictEqual(validated?.status, 'pending');
    assert.strictEqual(validated?.agentReview?.validatorId, validator.id);
    assert.strictEqual(validated?.agentReview?.validatorName, 'Review Bot');
    assert.strictEqual(validated?.agentReview?.recommendation, 'recommend-approve');
    assert.strictEqual(validated?.agentReview?.confidence, 0.9);
    assert.strictEqual(validated?.agentReview?.reason, 'matches scope');
    assert.ok(validated?.agentReview?.validatedAt);

    const validatedEvents = getStores().events.findByType('finding.validated');
    assert.strictEqual(validatedEvents.length, 1);
    assert.strictEqual(validatedEvents[0].payload.validatorId, validator.id);

    const audit = getStores().audit.loadAll().filter(a => a.action === 'finding.validated');
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(audit[0].targetId, finding.id);
  });

  it('blocks validators without the finding:validate permission', () => {
    const finding = materializeOne();
    const observer = seedAgent({ role: 'human', teamRole: 'observer' });

    assert.throws(
      () => findingsService.validateFinding(finding.id, { recommendation: 'recommend-approve' }, observer.id),
      /finding:validate/
    );

    const stored = getStores().findings.getById(finding.id);
    assert.strictEqual(stored?.agentReview, undefined);
    assert.strictEqual(stored?.agentValidationState, 'requested');
    assert.strictEqual(getStores().events.findByType('finding.validated').length, 0);
    assert.strictEqual(getStores().audit.loadAll().filter(a => a.action === 'finding.validated').length, 0);
  });

  it('persists the agent review on the finding record', () => {
    const finding = materializeOne();
    const validator = seedAgent({ role: 'agent', teamRole: 'reviewer' });

    findingsService.validateFinding(
      finding.id,
      { recommendation: 'request-revision', confidence: 0.6, reason: 'needs evidence' },
      validator.id
    );

    const reloaded = getStores().findings.getById(finding.id);
    assert.strictEqual(reloaded?.agentValidationState, 'validated');
    assert.strictEqual(reloaded?.agentReview?.recommendation, 'request-revision');
    assert.strictEqual(reloaded?.agentReview?.confidence, 0.6);
    assert.strictEqual(reloaded?.agentReview?.reason, 'needs evidence');
  });

  it('is idempotent for duplicate validation attempts', () => {
    const finding = materializeOne();
    const validator = seedAgent({ role: 'agent', teamRole: 'reviewer' });

    findingsService.validateFinding(
      finding.id,
      { recommendation: 'recommend-reject', confidence: 0.8, reason: 'out of scope' },
      validator.id
    );
    const again = findingsService.validateFinding(
      finding.id,
      { recommendation: 'recommend-approve', confidence: 0.1 },
      validator.id
    );

    assert.strictEqual(again?.agentReview?.recommendation, 'recommend-reject');
    assert.strictEqual(again?.agentReview?.reason, 'out of scope');
    assert.strictEqual(getStores().events.findByType('finding.validated').length, 1);
    assert.strictEqual(getStores().audit.loadAll().filter(a => a.action === 'finding.validated').length, 1);
  });

  it('never bypasses the human decision', () => {
    const finding = materializeOne();
    const validator = seedAgent({ role: 'agent', teamRole: 'reviewer' });
    const reviewer = seedAgent({ role: 'human', teamRole: 'human' });

    findingsService.validateFinding(finding.id, { recommendation: 'recommend-approve' }, validator.id);
    const approved = findingsService.updateStatus(finding.id, 'approved', reviewer.id);

    assert.strictEqual(approved?.status, 'approved');
    assert.strictEqual(approved?.agentReview?.recommendation, 'recommend-approve');
    assert.strictEqual(getStores().findings.getById(finding.id)?.status, 'approved');
  });

  it('requesting agent validation again is idempotent', () => {
    const finding = materializeOne();
    const again = findingsService.requestAgentValidation(finding.id);

    assert.strictEqual(again?.agentValidationState, 'requested');
    assert.strictEqual(getStores().events.findByType('finding.validation.requested').length, 1);
  });

  it('counts findings awaiting agent review vs human review', () => {
    const a = materializeOne();
    const b = materializeOne('Findings:\n- second claim\nErrors:\n0');
    const validator = seedAgent({ role: 'agent', teamRole: 'reviewer' });

    findingsService.validateFinding(a.id, { recommendation: 'recommend-approve' }, validator.id);

    const counts = findingsService.getFindingReviewCounts();
    assert.strictEqual(counts.pending, 2);
    assert.strictEqual(counts.pendingAgentReview, 1);
    assert.strictEqual(counts.pendingHumanReview, 1);
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

describe('operational execution & queue visibility (v0.11)', () => {
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

  it('lists runs and filters by status', () => {
    const agent = seedAgent();
    const task = makeTask({ type: 'feature' });

    const run = queueService.createRun(task.id, agent.id);
    queueService.startRun(run.id);
    queueService.finishRun(run.id, { status: 'completed', result: 'done\nErrors:\n0' });
    queueService.createRun(task.id, agent.id);

    assert.strictEqual(getRunsByFilter('all').length, 2);
    assert.strictEqual(getRunsByFilter('queued').length, 1);
    assert.strictEqual(getRunsByFilter('running').length, 0);
    assert.strictEqual(getRunsByFilter('completed').length, 1);
    assert.strictEqual(getRunsByFilter('all')[0].status, 'queued');
    assert.strictEqual(getRunsByFilter('all')[0].taskId, task.id);
  });

  it('classifies queued runs in retry backoff as retrying', () => {
    const agent = seedAgent();
    const task = makeTask();
    makeRun(task.id, agent.id, { status: 'queued', availableAt: new Date(Date.now() + 60000).toISOString() });

    assert.strictEqual(getRunsByFilter('retrying').length, 1);
    assert.strictEqual(getRunsByFilter('queued').length, 0);

    getStores().runs.update(getRunsByFilter('retrying')[0].id, { availableAt: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual(getRunsByFilter('retrying').length, 0);
    assert.strictEqual(getRunsByFilter('queued').length, 1);
  });

  it('processes the queue to claim queued runs', () => {
    const agent = seedAgent();
    const task = makeTask();
    const run = queueService.createRun(task.id, agent.id);

    const result = queueService.processQueue({ dryRun: false });
    assert.strictEqual(result.claims.length, 1);
    assert.strictEqual(result.started.length, 1);
    assert.strictEqual(result.skipped.length, 0);
    assert.strictEqual(getStores().runs.getById(run.id)?.status, 'running');

    const second = queueService.processQueue({ dryRun: false });
    assert.strictEqual(second.claims.length, 0);
    assert.strictEqual(second.started.length, 0);
  });

  it('builds a queue snapshot with run counts and worker occupancy', () => {
    const alpha = seedAgent({ name: 'Alpha' });
    const beta = seedAgent({ name: 'Beta' });
    const task = makeTask();

    const r1 = queueService.createRun(task.id, alpha.id);
    queueService.startRun(r1.id);
    queueService.createRun(task.id, alpha.id);

    const r3 = queueService.createRun(task.id, beta.id);
    queueService.startRun(r3.id);
    queueService.finishRun(r3.id, { status: 'failed', error: 'boom', classification: 'exit-nonzero' });

    const snap = getQueueSnapshot();
    assert.strictEqual(snap.runs.queued, 1);
    assert.strictEqual(snap.runs.running, 1);
    assert.strictEqual(snap.runs.failed, 1);
    assert.strictEqual(snap.allocated, 1);
    assert.strictEqual(snap.busyEmployees, 1);
    assert.strictEqual(snap.workerMode, queueService.getQueueSettings().workerMode);
  });

  it('reports run detail with task, agent, duration and linked findings', () => {
    const agent = seedAgent({ name: 'News Bot', agentConfig: makeAgentConfig() });
    const task = makeTask({ type: 'feature' });
    const run = makeRun(task.id, agent.id, {
      status: 'running',
      startedAt: new Date(Date.now() - 5000).toISOString()
    });

    queueService.finishRun(run.id, { status: 'completed', result: 'Findings:\n- claim one\n- claim two\nErrors:\n0' });

    const detail = runDetail(getStores().runs.getById(run.id)!);
    assert.strictEqual(detail.task?.title, task.title);
    assert.strictEqual(detail.task?.code, task.code);
    assert.strictEqual(detail.employee?.id, agent.id);
    assert.ok(detail.durationMs !== undefined && detail.durationMs >= 4900);
    assert.strictEqual(detail.findings.length, 2);
    assert.strictEqual(detail.findings[0].agentValidationState, 'requested');
    assert.ok(detail.findings.every(f => f.source?.runId === run.id));
  });

  it('reports the run → finding → validation chain', () => {
    const agent = seedAgent();
    const task = makeTask();
    const run = makeRun(task.id, agent.id, { status: 'running', startedAt: new Date().toISOString() });
    queueService.finishRun(run.id, { status: 'completed', result: 'Findings:\n- risky claim\nErrors:\n0' });

    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer' });
    const detail = runDetail(getStores().runs.getById(run.id)!);
    assert.strictEqual(detail.findings.length, 1);
    assert.strictEqual(detail.findings[0].agentValidationState, 'requested');

    findingsService.validateFinding(detail.findings[0].id, { recommendation: 'recommend-approve', confidence: 0.85 }, reviewer.id);

    const after = runDetail(getStores().runs.getById(run.id)!);
    assert.strictEqual(after.findings[0].agentReview?.validatorId, reviewer.id);
    assert.strictEqual(after.findings[0].agentReview?.recommendation, 'recommend-approve');
    assert.strictEqual(after.findings[0].status, 'pending');
  });

  it('reports the run → workflow → event rule trigger chain', () => {
    const agent = seedAgent();
    const task = makeTask();
    getDataService(ws.root).updateTask(task.id, { source: 'workflow', workflow: 'triage-wf' });
    const run = makeRun(task.id, agent.id, { status: 'queued' });
    getStores().eventRules.add({
      id: 'rule_1',
      name: 'Triage merged PRs',
      enabled: true,
      matcher: { eventType: 'pull_request.merged', source: 'github' },
      workflowId: 'wf_triage',
      workflowName: 'triage-wf',
      runCount: 1,
      recentTriggers: [
        {
          eventId: 'evt_1',
          eventType: 'pull_request.merged',
          workflowId: 'wf_triage',
          status: 'completed',
          createdAt: new Date().toISOString(),
          createdTaskIds: [task.id]
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const detail = runDetail(run);
    assert.strictEqual(detail.task?.source, 'workflow');
    assert.strictEqual(detail.task?.workflow, 'triage-wf');
    assert.strictEqual(detail.trigger?.ruleName, 'Triage merged PRs');
    assert.strictEqual(detail.trigger?.eventType, 'pull_request.merged');
  });

  it('handles retry and cancel via queue operations with permission checks', () => {
    const agent = seedAgent();
    const task = makeTask();
    const failed = queueService.createRun(task.id, agent.id);
    queueService.startRun(failed.id);
    queueService.finishRun(failed.id, { status: 'failed', error: 'boom', classification: 'exit-nonzero' });

    const observer = seedAgent({ role: 'human', teamRole: 'observer', name: 'Observer' });
    const pending = queueService.createRun(task.id, agent.id);
    assert.throws(() => queueService.cancelRun(pending.id, observer.id), /run:cancel/);
    queueService.cancelRun(pending.id, agent.id);
    assert.strictEqual(getStores().runs.getById(pending.id)?.status, 'cancelled');

    const retried = queueService.createRun(failed.taskId, failed.agentId);
    assert.strictEqual(retried.status, 'queued');
    assert.strictEqual(retried.attempts, 3);
    assert.strictEqual(getRunsByFilter('cancelled').length, 1);
  });

  it('reflects run state changes across snapshots and Control Center counters', () => {
    const agent = seedAgent();
    const task = makeTask();
    const run = queueService.createRun(task.id, agent.id);

    assert.strictEqual(getQueueSnapshot().runs.queued, 1);
    queueService.startRun(run.id);
    assert.strictEqual(getQueueSnapshot().runs.running, 1);
    assert.strictEqual(getQueueSnapshot().busyEmployees, 1);

    queueService.finishRun(run.id, { status: 'completed', result: 'Findings:\n- claim one\nErrors:\n0' });
    const snap = getQueueSnapshot();
    assert.strictEqual(snap.runs.completed, 1);
    assert.strictEqual(snap.runs.running, 0);
    assert.strictEqual(snap.busyEmployees, 0);
    assert.strictEqual(getActivitySummary().runs.completed, 1);

    assert.strictEqual(findingsService.getFindingReviewCounts().pendingAgentReview, 1);
    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer' });
    const [finding] = findingsService.allFindings();
    assert.ok(finding, 'finding materialized from run output');
    findingsService.validateFinding(finding.id, { recommendation: 'recommend-approve' }, reviewer.id);
    assert.strictEqual(findingsService.getFindingReviewCounts().pendingAgentReview, 0);
    assert.strictEqual(findingsService.getFindingReviewCounts().pendingHumanReview, 1);
  });
});

describe('execution windows — synchronous work (v0.11)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    executionWindowService.setAutoAdvanceEnabled(false);
  });

  afterEach(() => {
    executionWindowService.setAutoAdvanceEnabled(true);
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
    const now = new Date().toISOString();
    const wf: WorkflowDefinition = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: 'Research Flow',
      version: '1',
      enabled: true,
      steps: [{ id: 'tasks', type: 'task', title: 'Research {topic}', taskType: 'feature', priority: 'medium' }],
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    getStores().workflows.add(wf);
    return wf;
  }

  async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) {throw new Error('timed out waiting for condition');}
      await new Promise(r => setTimeout(r, 20));
    }
  }

  it('creates a persisted planned execution window', () => {
    const wf = seedWorkflow({ name: 'Brief Flow' });
    const created = executionWindowService.createExecutionWindow({
      name: 'Research Session',
      goal: 'gather intel',
      workflowIds: [wf.id]
    });

    assert.strictEqual(created.status, 'planned');
    assert.strictEqual(getStores().executionWindows.getById(created.id)?.name, 'Research Session');
    assert.strictEqual(getExecutionWindowReport(created).workflowNames[0], 'Brief Flow');
  });

  it('refuses to create a window without a workflow', () => {
    assert.throws(() => executionWindowService.createExecutionWindow({ name: 'Empty', workflowIds: [] }), /workflow/);
  });

  it('starts a window: plans tasks + runs and assigns them to a selected agent', async () => {
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow({ name: 'Research Flow' });
    const window = executionWindowService.createExecutionWindow({ name: 'Session 1', workflowIds: [wf.id], agentIds: [agent.id] });

    const started = await executionWindowService.startExecutionWindow(window.id);
    assert.strictEqual(started.status, 'running');
    assert.ok(started.startedAt);
    assert.strictEqual(started.taskIds.length, 1);
    assert.strictEqual(started.runIds.length, 1);

    const run = getStores().runs.getById(started.runIds[0])!;
    assert.strictEqual(run.agentId, agent.id);
    assert.strictEqual(run.status, 'queued');

    const task = getDataService(ws.root).getTask(started.taskIds[0])!;
    assert.strictEqual(task.agent, agent.id);
    assert.strictEqual(task.source, 'workflow');
    assert.strictEqual(task.workflow, 'Research Flow');
  });

  it("skips agents without run:create permission when assigning", async () => {
    const observer = seedAgent({ name: 'Observer', teamRole: 'observer', agentConfig: makeAgentConfig() });
    const worker = seedAgent({ name: 'Worker', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow();
    const window = executionWindowService.createExecutionWindow({ name: 'W2', workflowIds: [wf.id], agentIds: [observer.id, worker.id] });

    const started = await executionWindowService.startExecutionWindow(window.id);
    const run = getStores().runs.getById(started.runIds[0])!;
    assert.strictEqual(run.agentId, worker.id);
  });

  it('cancels outstanding runs and marks the window cancelled', async () => {
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow({ name: 'Flow A' });
    const wf2 = seedWorkflow({ name: 'Flow B', steps: [{ id: 't2', type: 'task', title: 'Second', taskType: 'bug', priority: 'low' }] });
    const window = executionWindowService.createExecutionWindow({ name: 'Session 3', workflowIds: [wf.id, wf2.id], agentIds: [agent.id] });

    const started = await executionWindowService.startExecutionWindow(window.id);
    assert.strictEqual(started.runIds.length, 2);

    const cancelled = executionWindowService.cancelExecutionWindow(window.id);
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.ok(cancelled.finishedAt);
    for (const runId of cancelled.runIds) {
      assert.strictEqual(getStores().runs.getById(runId)?.status, 'cancelled');
    }
  });

  it('drives the window through the queue to completion', async function () {
    this.timeout(10000);
    executionWindowService.setAutoAdvanceEnabled(true);
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow({ name: 'Research Flow' });
    const window = executionWindowService.createExecutionWindow({ name: 'Session Auto', workflowIds: [wf.id], agentIds: [agent.id], workerMode: 'noop' });

    await executionWindowService.startExecutionWindow(window.id);
    await waitFor(() => executionWindowService.getExecutionWindowById(window.id)?.status === 'completed');

    const finished = executionWindowService.getExecutionWindowById(window.id)!;
    assert.ok(finished.completionSummary, 'completion summary written on finalization');
    assert.strictEqual(finished.completionSummary!.runsCompleted, 1);
    const runId = finished.runIds[0];
    getStores().runs.update(runId, { result: 'Findings:\n- claim one\nErrors:\n0' });
    findingsService.materializeFindings(runId);
    const report = getExecutionWindowReport(finished);
    assert.strictEqual(report.runs.completed, 1);
    assert.strictEqual(report.runs.running, 0);
    assert.ok(report.durationMs !== undefined);
    assert.strictEqual(report.findings.total, 1, 'findings materialized from run output');
  });

  it('exposes validation progress in the window report', async function () {
    this.timeout(10000);
    executionWindowService.setAutoAdvanceEnabled(true);
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer' });
    const wf = seedWorkflow({ name: 'Research Flow' });
    const window = executionWindowService.createExecutionWindow({ name: 'Session Val', workflowIds: [wf.id], agentIds: [agent.id], workerMode: 'noop' });

    await executionWindowService.startExecutionWindow(window.id);
    await waitFor(() => executionWindowService.getExecutionWindowById(window.id)?.status === 'completed');

    const completed = executionWindowService.getExecutionWindowById(window.id)!;
    getStores().runs.update(completed.runIds[0], { result: 'Findings:\n- claim one\nErrors:\n0' });
    findingsService.materializeFindings(completed.runIds[0]);

    let report = getExecutionWindowReport(completed);
    assert.strictEqual(report.findings.total, 1);
    assert.strictEqual(report.findings.pendingAgentReview, 1);

    const [finding] = findingsService.allFindings();
    assert.ok(finding, 'finding materialized');
    findingsService.validateFinding(finding.id, { recommendation: 'recommend-approve' }, reviewer.id);

    report = getExecutionWindowReport(completed);
    assert.strictEqual(report.findings.pendingAgentReview, 0);
    assert.strictEqual(report.findings.pendingHumanReview, 1);
  });

  it('writes audit entries and milestone events for create/start/complete', async function () {
    this.timeout(10000);
    executionWindowService.setAutoAdvanceEnabled(true);
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow();
    const window = executionWindowService.createExecutionWindow({ name: 'Session Audit', workflowIds: [wf.id], agentIds: [agent.id], workerMode: 'noop' });

    await executionWindowService.startExecutionWindow(window.id);
    await waitFor(() => executionWindowService.getExecutionWindowById(window.id)?.status === 'completed');

    const actions = getStores().audit.loadAll()
      .filter(a => a.targetType === 'executionWindow' && a.targetId === window.id)
      .map(a => a.action);
    assert.ok(actions.includes('execwindow.create'));
    assert.ok(actions.includes('execwindow.start'));
    assert.ok(actions.includes('execwindow.complete'));

    const types = getStores().events.loadAll().map(e => e.type).filter(t => t.startsWith('execwindow.'));
    assert.ok(types.includes('execwindow.created'));
    assert.ok(types.includes('execwindow.started'));
    assert.ok(types.includes('execwindow.completed'));
  });
});

describe('end-to-end lifecycle smoke (v0.11 Slice 8)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    executionWindowService.setAutoAdvanceEnabled(false);
  });

  afterEach(() => {
    executionWindowService.setAutoAdvanceEnabled(true);
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
    const now = new Date().toISOString();
    const wf: WorkflowDefinition = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: 'Research Flow',
      version: '1',
      enabled: true,
      steps: [{ id: 'tasks', type: 'task', title: 'Research {topic}', taskType: 'feature', priority: 'medium' }],
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    getStores().workflows.add(wf);
    return wf;
  }

  async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) {throw new Error('timed out waiting for condition');}
      await new Promise(r => setTimeout(r, 20));
    }
  }

  function makeEvent(type: string, source: string, payload: Record<string, unknown>): EventRecord {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source,
      payload,
      timestamp: new Date().toISOString()
    };
  }

  it('smokes the full lifecycle: window → run → finding → agent validation → human decision', async function () {
    this.timeout(10000);
    executionWindowService.setAutoAdvanceEnabled(true);
    const agent = seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer' });
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead' });
    const wf = seedWorkflow({ name: 'Research Flow' });
    const window = executionWindowService.createExecutionWindow({ name: 'Full Lifecycle', workflowIds: [wf.id], agentIds: [agent.id], workerMode: 'noop' });

    assert.ok(getActivitySummary().recentEvents.some(e => e.type === 'execwindow.created'), 'window creation lands in the activity stream');

    await executionWindowService.startExecutionWindow(window.id);
    await waitFor(() => executionWindowService.getExecutionWindowById(window.id)?.status === 'completed');

    const finished = executionWindowService.getExecutionWindowById(window.id)!;
    const runId = finished.runIds[0];
    const run = getStores().runs.getById(runId)!;
    assert.strictEqual(run.status, 'completed');

    const report = getExecutionWindowReport(finished);
    assert.strictEqual(report.runs.completed, 1, 'window report counts the completed run');

    getStores().runs.update(runId, { result: 'Findings:\n- claim one\nErrors:\n0' });
    findingsService.materializeFindings(runId);
    const finding = findingsService.allFindings()[0];
    assert.ok(finding, 'finding materialized from run output');
    assert.strictEqual(finding.source?.runId, runId);

    const types = getActivitySummary().recentEvents.map(e => e.type);
    assert.ok(types.includes('execwindow.started'));
    assert.ok(types.includes('run.finished'));
    assert.ok(types.includes('finding.created'));

    findingsService.validateFinding(finding.id, { recommendation: 'recommend-approve', confidence: 0.9, reason: 'solid' }, reviewer.id);
    const validated = findingsService.allFindings()[0];
    assert.strictEqual(validated?.agentValidationState, 'validated');
    assert.strictEqual(validated?.agentReview?.validatorId, reviewer.id);
    assert.ok(getActivitySummary().recentEvents.some(e => e.type === 'finding.validated'));

    const decided = findingsService.updateStatus(finding.id, 'approved', lead.id);
    assert.strictEqual(decided?.status, 'approved');
    assert.strictEqual(decided?.decisionBy, lead.id);
    assert.ok(
      getActivitySummary().recentEvents.some(e => e.type === 'finding.resolved' && e.payload['status'] === 'approved'),
      'human decision resolves the finding in the activity stream'
    );
  });

  it('routes a lifecycle event through an event rule into a task and a queued run', async () => {
    seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const wf = seedWorkflow({ name: 'News Briefing' });
    const rule = eventRulesService.createEventRule({
      name: 'PR merged to news agent',
      matcher: { eventType: 'pull_request.merged', source: 'github' },
      workflowId: wf.id
    });

    const results = await eventRulesService.processEventRules(makeEvent('pull_request.merged', 'github', { repo: { name: 'morocco-news' } }));

    assert.strictEqual(results[0]?.triggered, true);
    assert.strictEqual(results[0]?.status, 'completed');
    assert.strictEqual(results[0]?.createdTaskIds?.length, 1);
    assert.strictEqual(getDataService().loadTasks().length, 1);
    assert.strictEqual(getStores().runs.loadAll().length, 1);

    const run = getStores().runs.loadAll()[0];
    assert.strictEqual(run.status, 'queued');
    const task = getDataService().getTask(run.taskId)!;
    assert.strictEqual(task.source, 'workflow');
    assert.strictEqual(task.workflow, 'News Briefing');
    assert.strictEqual(getStores().eventRules.getById(rule.id)?.runCount, 1);

    const fired = getActivitySummary().recentEvents.find(e => e.type === 'eventrule.fired');
    assert.ok(fired, 'eventrule.fired surfaces in the activity stream');
    assert.strictEqual(fired?.payload['ruleId'], rule.id);
  });

  it('routes a time-based schedule into a queued run (autonomy 2 = execute)', async () => {
    seedAgent({ name: 'Alpha', agentConfig: makeAgentConfig() });
    const now = new Date(2026, 0, 15, 9, 0, 0);
    const schedule: ScheduleRecord = {
      id: 'sched-slice8',
      name: 'Morning Brief',
      enabled: true,
      kind: 'interval',
      autonomyLevel: 2,
      taskTemplate: { name: 'Brief', title: 'Morning brief check', type: 'chore', priority: 'low', backlog: 'features' },
      intervalMs: 60_000,
      runCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    getStores().schedules.add(schedule);

    const result = await runSchedulerPass({ stores: getStores(), dataService: getDataService(), now });
    assert.strictEqual(result.fired.length, 1);
    assert.strictEqual(result.fired[0].mode, 'execute');
    assert.strictEqual(result.fired[0].scheduleId, 'sched-slice8');

    const run = getStores().runs.getById(result.fired[0].runId!)!;
    assert.strictEqual(run.status, 'queued');
    const task = getDataService().getTask(result.fired[0].taskId!)!;
    assert.strictEqual(task.source, 'scheduler');
    assert.strictEqual(getStores().schedules.getById('sched-slice8')?.runCount, 1);
    assert.strictEqual(getStores().events.findByType('schedule.fired').length, 1);

    const early = await runSchedulerPass({ stores: getStores(), dataService: getDataService(), now: new Date(now.getTime() + 30_000) });
    assert.strictEqual(early.fired.length, 0, 'interval not elapsed → no duplicate');

    const after = await runSchedulerPass({ stores: getStores(), dataService: getDataService(), now: new Date(now.getTime() + 120_000) });
    assert.strictEqual(after.fired.length, 1, 'interval elapsed → fires again');
  });
});

describe('v0.12 Proposal 1 — approvals resolve (Slice A)', () => {
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

  it('approves a pending config-change approval and applies its deferred operation', () => {
    setApprovalGate('config-change', 'manual');
    const employee = seedAgent();
    workforceService.applyConfigChange(employee.id, { agentConfig: { tool: 'opencode' } });

    const pending = getStores().approvals.loadAll().filter(a => a.type === 'config-change' && a.status === 'pending');
    assert.strictEqual(pending.length, 1);

    const approved = approvals.approve(pending[0].id);
    assert.strictEqual(approved?.status, 'approved');
    assert.ok(approved?.resolvedAt, 'approve records resolvedAt');
    assert.strictEqual(getStores().employees.getById(employee.id)?.agentConfig?.tool, 'opencode');

    assert.ok(
      getActivitySummary().recentEvents.some(e => e.type === 'approval.resolved' && e.payload['approvalId'] === pending[0].id),
      'approve lands in the activity stream'
    );
  });

  it('rejects a pending task-assignment approval without applying the assignment', () => {
    setApprovalGate('task-assignment', 'manual');
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead' });
    const agent = seedAgent({ name: 'Agent Beta' });
    const task = makeTask({ type: 'feature' });

    const approval = requestApproval({
      type: 'task-assignment',
      reason: 'Task assignment requires manual approval',
      requesterId: agent.id,
      target: `${task.code} → ${agent.name}`,
      pending: { op: 'assign-task', taskId: task.id, employeeId: agent.id }
    });

    const rejected = approvals.reject(approval.id, lead.id);
    assert.strictEqual(rejected?.status, 'rejected');
    assert.strictEqual(rejected?.decisionBy, lead.id);
    assert.strictEqual(getDataService().getTask(task.id)?.agent, undefined, 'assignment not applied on reject');
  });

  it('no-ops for a missing id and for a double resolve', () => {
    setApprovalGate('config-change', 'manual');
    const employee = seedAgent();
    workforceService.applyConfigChange(employee.id, { agentConfig: { tool: 'opencode' } });

    const pending = getStores().approvals.loadAll().filter(a => a.type === 'config-change' && a.status === 'pending')[0];

    assert.strictEqual(approvals.approve('approval_missing'), undefined);

    assert.strictEqual(approvals.approve(pending.id)?.status, 'approved');
    assert.strictEqual(approvals.approve(pending.id), undefined, 'already resolved approval cannot be resolved again');
    assert.strictEqual(approvals.reject(pending.id), undefined);
  });
});

describe('v0.12 Proposal 1 — tasks CRUD (Slice B)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('updates title, priority, status and agent on a task', () => {
    const employee = makeEmployee({ name: 'Agent Alpha' });
    getStores().employees.add(employee);
    const task = makeTask({ type: 'feature', priority: 'medium', status: 'waiting' });

    taskService.updateTask(task.id, {
      title: 'Updated Title',
      priority: 'high',
      status: 'in-progress',
      agent: employee.id
    });

    const updated = getDataService().getTask(task.id);
    assert.strictEqual(updated?.title, 'Updated Title');
    assert.strictEqual(updated?.priority, 'high');
    assert.strictEqual(updated?.status, 'in-progress');
    assert.strictEqual(updated?.agent, employee.id);
  });

  it('returns undefined for a missing task', () => {
    assert.strictEqual(getDataService().getTask('task_nope'), undefined);
  });

  it('deletes a task so it no longer appears in the store', () => {
    const task = makeTask({ type: 'feature' });
    assert.ok(getDataService().getTask(task.id), 'task exists before delete');

    taskService.deleteTask(task.id);
    assert.strictEqual(getDataService().getTask(task.id), undefined);
    assert.strictEqual(getDataService().loadTasks().find(t => t.id === task.id), undefined);
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice C)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Investigate flaky login test',
      runId: 'run_seed',
      agent: 'emp_none',
      severity: 'medium',
      suggestedTaskType: 'bug',
      suggestedPriority: 'high',
      suggestedWorkflow: 'w_fix',
      ...overrides
    });
  }

  it('creates exactly one proposal per finding and is idempotent', () => {
    const finding = seedFinding();
    const first = classificationService.createProposal(finding);
    assert.strictEqual(first?.status, 'pending');
    assert.strictEqual(first?.type, 'bug');
    assert.strictEqual(first?.priority, 'high');
    assert.strictEqual(first?.workflow, 'w_fix');

    const second = classificationService.createProposal(finding);
    assert.strictEqual(second?.id, first?.id, 'repeat classify returns the same proposal');
    assert.strictEqual(getStores().proposals.loadAll().length, 1);
  });

  it('suppresses duplicates against an open matching task but not a finished one', () => {
    makeTask({ title: 'Investigate flaky login test', status: 'waiting' });

    const blocked = seedFinding({ title: 'Investigate flaky login test' });
    const proposal = classificationService.createProposal(blocked);
    assert.strictEqual(proposal?.status, 'duplicate');
    assert.strictEqual(getDataService().loadTasks().length, 1, 'no task is created for a duplicate');

    makeTask({ title: 'Archive old reports', status: 'done' });
    const free = seedFinding({ title: 'Archive old reports' });
    const freeProposal = classificationService.createProposal(free);
    assert.strictEqual(freeProposal?.status, 'pending', 'a finished task does not block classification');
  });

  it('honors the per-pass cap and classifies the highest severity first', async () => {
    setApprovalGate('task-proposal', 'auto');
    const agent = seedAgent();
    for (let i = 0; i < 5; i += 1) {
      seedFinding({ title: `Low severity item ${i}`, severity: 'low', runId: `run_low_${i}`, agent: agent.id });
    }
    for (let i = 0; i < 2; i += 1) {
      seedFinding({ title: `High severity item ${i}`, severity: 'high', runId: `run_high_${i}`, agent: agent.id });
    }
    getStores().queue.saveSettings({ maxProposalsPerPass: 3 });

    const result = await classificationService.runClassificationPass();
    assert.strictEqual(result.scanned, 7);
    assert.strictEqual(result.proposed, 3);
    assert.strictEqual(result.applied, 3);
    assert.strictEqual(result.duplicates, 0);

    const titles = getDataService().loadTasks().map(t => t.title);
    assert.ok(titles.includes('High severity item 0'), 'high severity classified first');
    assert.ok(titles.includes('High severity item 1'));
    assert.ok(titles.some(t => t.startsWith('Low severity item')), 'one low severity item fits the cap');
  });

  it('requests approval under a manual gate and applies only on approve', async () => {
    setApprovalGate('task-proposal', 'manual');
    const approved = seedFinding({ title: 'Fragile checkout flow', runId: 'run_checkout' });
    const result = await classificationService.runClassificationPass();

    assert.strictEqual(result.requestedApproval, 1);
    const approvalsList = getStores().approvals.loadAll().filter(a => a.type === 'task-proposal' && a.status === 'pending');
    assert.strictEqual(approvalsList.length, 1);
    assert.strictEqual(getDataService().loadTasks().length, 0, 'nothing is created before approval');

    const resolved = approvals.approve(approvalsList[0].id);
    assert.strictEqual(resolved?.status, 'approved');
    assert.strictEqual(getDataService().loadTasks().length, 1);
    const applied = getStores().proposals.byFindingId(approved.id);
    assert.strictEqual(applied?.status, 'applied');
    assert.strictEqual(getStores().findings.getById(approved.id)?.taskId, getDataService().loadTasks()[0].id);
    assert.strictEqual(getStores().findings.getById(approved.id)?.status, 'approved');
  });

  it('keeps a manual-gate proposal unapplied on a reject', async () => {
    setApprovalGate('task-proposal', 'manual');
    const finding = seedFinding({ title: 'Slow build pipeline', runId: 'run_build' });
    await classificationService.runClassificationPass();
    const approvalsList = getStores().approvals.loadAll().filter(a => a.type === 'task-proposal' && a.status === 'pending');
    assert.strictEqual(approvalsList.length, 1);

    const rejected = approvals.reject(approvalsList[0].id);
    assert.strictEqual(rejected?.status, 'rejected');
    const proposal = getStores().proposals.byFindingId(finding.id);
    assert.strictEqual(proposal?.status, 'pending', 'reject does not apply the proposal');
    assert.strictEqual(getDataService().loadTasks().length, 0, 'no task is created on a reject');
  });

  it('does not create a task when the actor lacks classification:apply', async () => {
    setApprovalGate('task-proposal', 'auto');
    const plainAgent = seedAgent();
    const finding = seedFinding({ title: 'Secret scan backlog', runId: 'run_secret' });

    const result = await classificationService.runClassificationPass({ actorId: plainAgent.id });
    assert.strictEqual(result.applied, 0);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(getStores().proposals.byFindingId(finding.id)?.status, 'failed');
    assert.strictEqual(getDataService().loadTasks().length, 0);
  });

  it('marks an invalid suggestion as failed without creating a task', () => {
    const finding = seedFinding({ suggestedTaskType: 'suggestion' as any });
    const proposal = classificationService.createProposal(finding);

    assert.strictEqual(proposal?.status, 'failed');
    assert.ok(proposal?.reason, 'failure carries a reason');
    assert.strictEqual(getStores().proposals.loadAll().length, 1);
    assert.strictEqual(getDataService().loadTasks().length, 0, 'no task is created from a failed suggestion');
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice D — LLM)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Ambiguous network timeout',
      runId: 'run_llm_1',
      agent: 'emp_none',
      severity: 'medium',
      ...overrides
    });
  }

  function fakeProvider(json: Record<string, unknown>): LLMProvider {
    return {
      kind: 'ollama' as any,
      async chat() { return { text: JSON.stringify(json) }; }
    };
  }

  function failingProvider(message: string): LLMProvider {
    return {
      kind: 'ollama' as any,
      async chat() { throw new Error(message); }
    };
  }

  function textualProvider(text: string): LLMProvider {
    return {
      kind: 'ollama' as any,
      async chat() { return { text }; }
    };
  }

  function uniqueTitledProvider(): LLMProvider {
    return {
      kind: 'ollama' as any,
      async chat({ messages }: any) {
        const user = messages.filter((m: ChatMessage) => m.role === 'user').map((m: ChatMessage) => m.content).join('\n');
        const titleMatch = user.match(/Title:\s*(.+)\n/);
        const title = titleMatch ? titleMatch[1].trim() : 'Classified finding';
        return { text: JSON.stringify({ title: `Classified: ${title}`, type: 'feature', priority: 'medium' }) };
      }
    };
  }

  it('classifies a finding from a fake provider into a valid proposal', async () => {
    const agent = seedAgent({ name: 'Morocco Agent', modelProfile: { name: 'Morocco Agent', provider: 'ollama', model: 'gemma4', baseUrl: 'http://localhost:11434' } });
    const finding = seedFinding({ agent: agent.id });

    const outcome = await classifyFinding(finding, { providerOverride: fakeProvider({ title: 'Add timeout handling', type: 'bug', priority: 'high', workflow: 'w_timeouts', confidence: 0.95 }) });
    assert.strictEqual(outcome.ok, true);
    if (!outcome.ok) {return;}
    assert.strictEqual(outcome.value.title, 'Add timeout handling');
    assert.strictEqual(outcome.value.type, 'bug');
    assert.strictEqual(outcome.value.priority, 'high');
    assert.strictEqual(outcome.value.workflow, 'w_timeouts');
    assert.strictEqual(outcome.value.confidence, 0.95);

    const proposal = classificationService.createProposal(finding, outcome.value, agent.id);
    assert.strictEqual(proposal?.status, 'pending');
    assert.strictEqual(proposal?.title, 'Add timeout handling');
  });

  it('marks provider failures and unclassifiable output as failed without throwing', async () => {
    setApprovalGate('task-proposal', 'auto');
    const agent = seedAgent({ name: 'Fail Agent', modelProfile: { name: 'Fail Agent', provider: 'ollama', model: 'gemma4', baseUrl: 'http://localhost:11434' } });
    const findingJunk = seedFinding({ title: 'Junk output finding', runId: 'run_junk', agent: agent.id });
    const findingThrow = seedFinding({ title: 'Throwing provider finding', runId: 'run_throw', agent: agent.id });

    const result = await classificationService.runClassificationPass({
      classifyWithLlm: true,
      providerOverride: textualProvider('This is not JSON at all')
    });
    assert.strictEqual(result.failed, 2);
    assert.strictEqual(result.applied, 0);
    assert.strictEqual(getStores().proposals.byFindingId(findingJunk.id)?.status, 'failed');
    assert.ok(getStores().proposals.byFindingId(findingJunk.id)?.reason);
    assert.strictEqual(getStores().proposals.byFindingId(findingThrow.id)?.status, 'failed');
    assert.strictEqual(getDataService().loadTasks().length, 0);
  });

  it('falls back to a severity-based priority when the provider omits priority', async () => {
    const agent = seedAgent({ name: 'Low Agent', modelProfile: { name: 'Low Agent', provider: 'ollama', model: 'gemma4', baseUrl: 'http://localhost:11434' } });
    const finding = seedFinding({ severity: 'low', agent: agent.id });

    const outcome = await classifyFinding(finding, { providerOverride: fakeProvider({ title: 'Archive expired cache', type: 'chore' }) });
    assert.strictEqual(outcome.ok, true);
    if (!outcome.ok) {return;}
    assert.strictEqual(outcome.value.priority, undefined, 'provider omitted priority');

    const proposal = classificationService.createProposal(finding, outcome.value, agent.id);
    assert.strictEqual(proposal?.priority, 'low', 'severity-to-priority fallback applied');
  });

  it('runs a full LLM pass with a fake provider, applies under a gate, and respects the cap', async () => {
    setApprovalGate('task-proposal', 'auto');
    getStores().queue.saveSettings({ maxProposalsPerPass: 2 });
    const agent = seedAgent({ name: 'Batch Agent', modelProfile: { name: 'Batch Agent', provider: 'ollama', model: 'gemma4', baseUrl: 'http://localhost:11434' } });

    for (let i = 0; i < 3; i += 1) {
      seedFinding({ title: `Needs classification ${i}`, runId: `run_cap_${i}`, agent: agent.id, severity: i === 0 ? 'high' : 'low' });
    }

    const result = await classificationService.runClassificationPass({
      classifyWithLlm: true,
      providerOverride: uniqueTitledProvider()
    });

    assert.strictEqual(result.scanned, 3);
    assert.strictEqual(result.proposed, 2);
    assert.strictEqual(result.applied, 2);
    assert.strictEqual(result.duplicates, 0);
    assert.strictEqual(getDataService().loadTasks().length, 2);
    assert.strictEqual(getStores().proposals.loadAll().length, 2, 'the capped-out finding is not proposed');
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice E — proposals review)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Timeout in checkout flow',
      runId: 'run_review_1',
      agent: 'emp_none',
      severity: 'medium',
      ...overrides
    });
  }

  function seedPendingProposal(proposedBy?: string) {
    const finding = seedFinding();
    return classificationService.createProposal(finding, { title: 'Handle checkout timeout', type: 'bug', priority: 'high' }, proposedBy);
  }

  it('rejects a pending proposal without touching tasks or the finding', () => {
    const proposal = seedPendingProposal();
    assert.strictEqual(proposal?.status, 'pending');

    const rejected = classificationService.rejectProposal(proposal!.id);
    assert.strictEqual(rejected?.status, 'rejected');
    assert.strictEqual(rejected?.reason, 'rejected by review');
    assert.strictEqual(getDataService().loadTasks().length, 0, 'reject never creates a task');
    assert.strictEqual(getStores().findings.getById(proposal!.findingId)?.status, 'pending', 'finding stays pending');
    assert.strictEqual(getStores().audit.loadAll().filter(a => a.action === 'classification.reject').length, 1);
  });

  it('is a no-op for an applied proposal and undefined for a missing id', () => {
    const proposal = seedPendingProposal();
    const applied = classificationService.applyProposal(proposal!.id);
    assert.strictEqual(applied?.status, 'applied');

    const again = classificationService.rejectProposal(proposal!.id);
    assert.strictEqual(again?.status, 'applied', 'an applied proposal cannot be rejected');
    assert.strictEqual(classificationService.rejectProposal('prop_nope'), undefined);
  });

  it('enforces classification:review — plain agents throw, lead/reviewer/human/system pass', () => {
    const plainAgent = seedAgent();
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Reviewer' });
    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Review Bot' });
    const human = seedAgent({ role: 'human', teamRole: 'human', name: 'Human Reviewer' });

    const denied = seedPendingProposal();
    assert.throws(
      () => classificationService.rejectProposal(denied!.id, plainAgent.id),
      /lacks permission 'classification:review'/
    );
    assert.strictEqual(getStores().proposals.byFindingId(denied!.findingId)?.status, 'pending', 'denied actor changes nothing');

    for (const reviewerActor of [lead.id, reviewer.id, human.id]) {
      const p = seedPendingProposal(reviewerActor);
      assert.strictEqual(classificationService.rejectProposal(p!.id, reviewerActor)?.status, 'rejected');
    }

    const system = seedPendingProposal();
    assert.strictEqual(classificationService.rejectProposal(system!.id)?.status, 'rejected');
  });

  it('exposes the webview DTO field set from stored proposals', () => {
    const finding = seedFinding({ severity: 'high' });
    const proposal = classificationService.createProposal(
      finding,
      { title: 'Rotate API keys', type: 'chore', priority: 'high', workflow: 'w_ops', confidence: 0.87 }
    );

    const stored = getStores().proposals.byFindingId(finding.id);
    assert.strictEqual(stored?.id, proposal?.id);
    assert.strictEqual(stored?.title, 'Rotate API keys');
    assert.strictEqual(stored?.type, 'chore');
    assert.strictEqual(stored?.priority, 'high');
    assert.strictEqual(stored?.workflow, 'w_ops');
    assert.strictEqual(stored?.confidence, 0.87);
    assert.strictEqual(stored?.status, 'pending');
    assert.strictEqual(stored?.findingId, finding.id);
  });

  it('applies a pending proposal into a task from the review surface and dedups a second apply', () => {
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Reviewer' });
    const proposal = seedPendingProposal(lead.id);

    const applied = classificationService.applyProposal(proposal!.id, lead.id);
    assert.strictEqual(applied?.status, 'applied');
    assert.ok(applied?.appliedTaskId, 'applied proposal carries the created task id');

    const tasks = getDataService().loadTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Handle checkout timeout');
    const linked = getStores().findings.getById(proposal!.findingId);
    assert.strictEqual(linked?.status, 'approved');
    assert.strictEqual(linked?.taskId, applied!.appliedTaskId);

    const second = classificationService.applyProposal(proposal!.id, lead.id);
    assert.strictEqual(second?.status, 'applied', 're-applying an applied proposal is a no-op');
    assert.strictEqual(getDataService().loadTasks().length, 1, 'no second task is created');
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice F — scheduled passes)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedSchedule(action: 'task' | 'classify', overrides: Partial<ScheduleRecord> = {}) {
    const schedule: ScheduleRecord = {
      id: 'sched-classify-f',
      name: 'Daily Classification',
      enabled: true,
      kind: 'interval',
      action,
      autonomyLevel: 2,
      intervalMs: 60_000,
      runCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
    getStores().schedules.add(schedule);
    return schedule;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Investigate scheduled flake',
      runId: 'run_sched_seed',
      agent: 'emp_none',
      severity: 'medium',
      suggestedTaskType: 'bug',
      suggestedPriority: 'high',
      suggestedWorkflow: 'w_fix',
      ...overrides
    });
  }

  it('an auto-gated scheduled pass turns findings into proposals and applied tasks', async () => {
    setApprovalGate('task-proposal', 'auto');
    seedSchedule('classify');
    for (let i = 0; i < 2; i += 1) {
      seedFinding({ title: `Scheduled item ${i}`, runId: `run_sched_${i}`, severity: 'high' });
    }

    const result = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 16, 8, 0, 0) });
    assert.strictEqual(result.fired.length, 1);
    const fired = result.fired[0];
    assert.strictEqual(fired.mode, 'execute');
    assert.strictEqual(fired.scheduleId, 'sched-classify-f');
    assert.ok(fired.classification, 'a classify fire carries the classification summary');
    assert.strictEqual(fired.classification!.proposed, 2);
    assert.strictEqual(fired.classification!.applied, 2);

    assert.strictEqual(getDataService().loadTasks().length, 2);
    assert.strictEqual(getStores().proposals.loadAll().filter(p => p.status === 'applied').length, 2);
    assert.strictEqual(getStores().events.findByType('classification.pass').length, 1);
    assert.strictEqual(getStores().schedules.getById('sched-classify-f')?.runCount, 1);
  });

  it('a manual task-proposal gate holds scheduled classifications for approval', async () => {
    setApprovalGate('task-proposal', 'manual');
    seedSchedule('classify');
    seedFinding({ title: 'Scheduled risky fix', runId: 'run_manual' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 16, 8, 0, 0) });
    assert.strictEqual(result.fired.length, 1);
    assert.strictEqual(result.fired[0].classification!.requestedApproval, 1);
    assert.strictEqual(getDataService().loadTasks().length, 0, 'nothing is applied before approval');

    const pendingApprovals = getStores().approvals.loadAll().filter(a => a.type === 'task-proposal' && a.status === 'pending');
    assert.strictEqual(pendingApprovals.length, 1);
    assert.strictEqual(getStores().proposals.loadAll().length, 1);
  });

  it('a disabled classify schedule is skipped without running a pass', async () => {
    seedSchedule('classify', { enabled: false });
    seedFinding({ title: 'Must not classify', runId: 'run_disabled' });

    const result = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 16, 8, 0, 0) });
    assert.strictEqual(result.fired.length, 0);
    assert.deepStrictEqual(result.skipped, [{ scheduleId: 'sched-classify-f', reason: 'disabled' }]);
    assert.strictEqual(getStores().proposals.loadAll().length, 0);
    assert.strictEqual(getStores().events.findByType('classification.pass').length, 0);
  });

  it('scheduled classification honors maxProposalsPerPass', async () => {
    setApprovalGate('task-proposal', 'auto');
    seedSchedule('classify');
    for (let i = 0; i < 5; i += 1) {
      seedFinding({ title: `Capped item ${i}`, runId: `run_cap_${i}`, severity: 'low' });
    }
    getStores().queue.saveSettings({ maxProposalsPerPass: 2 });

    const result = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(2026, 0, 16, 8, 0, 0) });
    const fired = result.fired[0];
    assert.strictEqual(fired.classification!.scanned, 5);
    assert.strictEqual(fired.classification!.proposed, 2);
    assert.strictEqual(fired.classification!.applied, 2);
    assert.strictEqual(getDataService().loadTasks().length, 2);
  });

  it('overlapping or back-to-back passes never duplicate proposals or tasks', async () => {
    setApprovalGate('task-proposal', 'auto');
    const now = new Date(2026, 0, 16, 8, 0, 0);
    seedSchedule('classify');
    seedFinding({ title: 'Only once', runId: 'run_once' });

    await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now });
    assert.strictEqual(getDataService().loadTasks().length, 1);

    const early = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(now.getTime() + 30_000) });
    assert.strictEqual(early.fired.length, 0, 'interval not elapsed → no overlapping pass');

    const after = await runSchedulerPass({ stores: getStores(ws.root), dataService: getDataService(ws.root), now: new Date(now.getTime() + 120_000) });
    assert.strictEqual(after.fired.length, 1, 'the next occurrence fires again');
    assert.strictEqual(after.fired[0].classification!.proposed, 0, 'no pending findings → no new proposals');
    assert.strictEqual(getStores().proposals.loadAll().length, 1, 'no duplicate proposal');
    assert.strictEqual(getDataService().loadTasks().length, 1, 'no duplicate task');
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice G — proposal editing)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Investigate login timeout',
      runId: 'run_edit_seed',
      agent: 'emp_none',
      severity: 'medium',
      suggestedTaskType: 'bug',
      suggestedPriority: 'high',
      suggestedWorkflow: 'w_fix',
      ...overrides
    });
  }

  function seedPendingProposal(proposedBy?: string) {
    const finding = seedFinding();
    return classificationService.createProposal(finding, { title: 'Handle login timeout', type: 'bug', priority: 'high', workflow: 'w_fix' }, proposedBy);
  }

  it('updates a pending proposal payload, preserving classification evidence', () => {
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Editor' });
    const proposal = seedPendingProposal();
    assert.strictEqual(proposal?.status, 'pending');
    const findingId = proposal!.findingId;

    const edited = classificationService.editProposal(proposal!.id, { title: 'Improved login timeout', priority: 'low' }, lead.id);
    assert.strictEqual(edited?.status, 'pending');
    assert.strictEqual(edited?.title, 'Improved login timeout');
    assert.strictEqual(edited?.priority, 'low');
    assert.strictEqual(edited?.type, 'bug');
    assert.strictEqual(edited?.workflow, 'w_fix');
    assert.ok(edited?.editedAt, 'editedAt is set');
    assert.strictEqual(edited?.editedBy, lead.id);
    assert.strictEqual(edited?.edits?.length, 1);
    assert.strictEqual(edited?.edits?.[0]?.before.title, 'Handle login timeout');
    assert.strictEqual(edited?.edits?.[0]?.before.priority, 'high');
    assert.strictEqual(edited?.edits?.[0]?.after.title, 'Improved login timeout');
    assert.strictEqual(edited?.edits?.[0]?.after.priority, 'low');

    // finding is untouched
    const finding = getStores().findings.getById(findingId);
    assert.strictEqual(finding?.title, 'Investigate login timeout');

    // audit + event
    const audits = getStores().audit.loadAll().filter(a => a.action === 'classification.edit');
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].targetId, proposal!.id);
    assert.strictEqual(getStores().events.findByType('task.proposal.edited').length, 1);
  });

  it('throws on invalid edits and persists nothing', () => {
    const proposal = seedPendingProposal();
    assert.throws(() => classificationService.editProposal(proposal!.id, { type: 'suggestion' }), /invalid proposal type/);
    assert.throws(() => classificationService.editProposal(proposal!.id, { priority: 'critical' }), /invalid proposal priority/);
    assert.throws(() => classificationService.editProposal(proposal!.id, { title: '   ' }), /invalid proposal title/);

    const original = getStores().proposals.getById(proposal!.id);
    assert.strictEqual(original?.title, 'Handle login timeout');
    assert.strictEqual(original?.type, 'bug');
    assert.ok(!original?.edits || original.edits.length === 0, 'no edits persisted');
    assert.strictEqual(getStores().audit.loadAll().filter(a => a.action === 'classification.edit').length, 0);
  });

  it('is a no-op for a non-pending proposal and returns undefined for a missing id', () => {
    const finding = seedFinding({ title: 'Edit applied no-op', runId: 'run_applied_edit' });
    const proposal = classificationService.createProposal(finding, { title: 'Applied task', type: 'chore', priority: 'low' });
    classificationService.applyProposal(proposal!.id);

    const applied = classificationService.editProposal(proposal!.id, { title: 'No good' });
    assert.strictEqual(applied?.status, 'applied');
    assert.strictEqual(applied?.title, 'Applied task');

    const missing = classificationService.editProposal('missing_id');
    assert.strictEqual(missing, undefined);
  });

  it('enforces classification:review — plain agents throw, lead/reviewer/human/system pass', () => {
    const proposal = seedPendingProposal();
    const agent = seedAgent();
    assert.throws(() => classificationService.editProposal(proposal!.id, { priority: 'low' }, agent.id), /classification:review/);

    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead E' });
    assert.strictEqual(classificationService.editProposal(proposal!.id, { priority: 'low' }, lead.id)?.priority, 'low');

    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer E' });
    assert.strictEqual(classificationService.editProposal(proposal!.id, { type: 'chore' }, reviewer.id)?.type, 'chore');

    const human = seedAgent({ role: 'human', teamRole: 'human', name: 'Human E' });
    assert.strictEqual(classificationService.editProposal(proposal!.id, { title: 'Human edited' }, human.id)?.title, 'Human edited');

    // system (no actorId) succeeds on a fresh proposal
    const fresh = seedPendingProposal();
    assert.strictEqual(classificationService.editProposal(fresh!.id, { title: 'System edited' })?.title, 'System edited');
  });

  it('Apply creates a task from the edited payload values', () => {
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Apply' });
    const finding = seedFinding({ title: 'Edit then apply', runId: 'run_edit_apply' });
    const proposal = classificationService.createProposal(finding, { title: 'Original task', type: 'bug', priority: 'high', workflow: 'w_fix' });

    const edited = classificationService.editProposal(proposal!.id, { title: 'Revised task', type: 'chore', priority: 'low', workflow: 'w_ops' }, lead.id);
    assert.strictEqual(edited?.status, 'pending');

    const applied = classificationService.applyProposal(edited!.id, lead.id);
    assert.strictEqual(applied?.status, 'applied');

    const tasks = getDataService().loadTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Revised task');
    assert.strictEqual(tasks[0].type, 'chore');
    assert.strictEqual(tasks[0].priority, 'low');
    assert.strictEqual(tasks[0].workflow, 'w_ops');

    const updatedFinding = getStores().findings.getById(finding.id);
    assert.strictEqual(updatedFinding?.title, 'Edit then apply');
    assert.strictEqual(updatedFinding?.status, 'approved');
    assert.strictEqual(updatedFinding?.taskId, tasks[0].id);
  });
});

describe('v0.12 Proposal 2 — autonomous classification (Slice H — requeue rejected proposals)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    taskService.getTaskService(ws.root);
  });

  afterEach(() => {
    ws.cleanup();
  });

  function seedAgent(overrides: Parameters<typeof makeEmployee>[0] = {}) {
    const employee = makeEmployee(overrides);
    getStores().employees.add(employee);
    return employee;
  }

  function seedFinding(overrides: Partial<Parameters<typeof findingsService.createFinding>[0]> = {}) {
    return findingsService.createFinding({
      title: 'Investigate requeue lifecycle',
      runId: 'run_requeue',
      agent: 'emp_requeue',
      severity: 'medium',
      suggestedTaskType: 'bug',
      suggestedPriority: 'high',
      suggestedWorkflow: 'w_fix',
      ...overrides
    });
  }

  function seedPendingProposal(proposedBy?: string) {
    const finding = seedFinding();
    return classificationService.createProposal(finding, { title: 'Handle requeue target', type: 'bug', priority: 'high', workflow: 'w_fix' }, proposedBy);
  }

  function seedRejectedProposal(rejectedBy?: string) {
    const proposal = seedPendingProposal();
    if (!proposal) {return undefined;}
    const rejected = classificationService.rejectProposal(proposal.id, rejectedBy);
    assert.strictEqual(rejected?.status, 'rejected');
    return rejected;
  }

  it('requeues a rejected proposal back to pending, clearing the reason, auditing and keeping the finding as-is', () => {
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Requeue' });
    const proposal = seedRejectedProposal(lead.id);
    assert.strictEqual(proposal?.status, 'rejected');

    const findingId = proposal!.findingId земли;
    const requeued = classificationService.requeueProposal(proposal!.id, lead.id);

    assert.strictEqual(requeued?.status, 'pending');
    assert.strictEqual(requeued?.reason, undefined, 'reason cleared');
    assert.ok(requeued?.requeuedAt, 'requeuedAt is set');
    assert.strictEqual(requeued?.title, 'Handle requeue target', 'classified payload preserved');

    // finding untouched — requeue is a pure proposal transition, not a re-classification
    const finding = getStores().findings.getById(findingId);
    assert.strictEqual(finding?.title, 'Investigate requeue lifecycle');
    assert.strictEqual(finding?.status, 'pending');

    // audit + event, but never a classification (re)pass
    const audits = getStores().audit.loadAll().filter(a => a.action === 'classification.requeue');
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].targetId, proposal!.id);
    assert.strictEqual(getStores().events.findByType('task.proposal.requeued').length, 1);
    assert.strictEqual(getStores().events.findByType('classification.pass').length, 0);
  });

  it('is a no-op for non-rejected proposals and returns undefined for a missing id', () => {
    // pending stays pending
    const pendingProposal = seedPendingProposal();
    assert.strictEqual(classificationService.requeueProposal(pendingProposal!.id)?.status, 'pending');

    // applied stays applied
    const applyLead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Requeue Noop' });
    const appliedProposal = seedPendingProposal();
    classificationService.applyProposal(appliedProposal!.id);
    assert.strictEqual(classificationService.requeueProposal(appliedProposal!.id, applyLead.id)?.status, 'applied');

    // missing id
    assert.strictEqual(classificationService.requeueProposal('prop_missing_requeue'), undefined);
  });

  it('enforces classification:review — plain agents throw, lead/reviewer/human/system pass', () => {
    const plainAgent = seedAgent({ name: 'Requeue Plain' });
    const rejected = seedRejectedProposal();
    assert.throws(() => classificationService.requeueProposal(rejected!.id, plainAgent.id), /classification:review/);
    assert.strictEqual(getStores().proposals.getById(rejected!.id)?.status, 'rejected', 'nothing persisted on denial');

    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Requeue Permit' });
    const leadRejected = seedRejectedProposal();
    assert.strictEqual(classificationService.requeueProposal(leadRejected!.id, lead.id)?.status, 'pending');

    const reviewer = seedAgent({ role: 'agent', teamRole: 'reviewer', name: 'Reviewer Requeue' });
    const reviewerRejected = seedRejectedProposal();
    assert.strictEqual(classificationService.requeueProposal(reviewerRejected!.id, reviewer.id)?.status, 'pending');

    const human = seedAgent({ role: 'human', teamRole: 'human', name: 'Human Requeue' });
    const humanRejected = seedRejectedProposal();
    assert.strictEqual(classificationService.requeueProposal(humanRejected!.id, human.id)?.status, 'pending');

    // system (no actorId) works on a fresh rejected proposal
    const systemRejected = seedRejectedProposal();
    assert.strictEqual(classificationService.requeueProposal(systemRejected!.id)?.status, 'pending');
  });

  it('applies a requeued proposal as-is without re-running classification — payload and finding preserved', () => {
    const lead = seedAgent({ role: 'human', teamRole: 'lead', name: 'Lead Requeue Apply' });
    const finding = seedFinding({ title: 'Requeue then apply' });
    const proposal = classificationService.createProposal(finding, { title: 'Requeue apply task', type: 'bug', priority: 'high', workflow: 'w_fix' });
    classificationService.rejectProposal(proposal!.id);

    const requeued = classificationService.requeueProposal(proposal!.id, lead.id);
    assert.strictEqual(requeued?.status, 'pending');

    const applied = classificationService.applyProposal(requeued!.id, lead.id);
    assert.strictEqual(applied?.status, 'applied');

    // no fresh classification pass — requeue is a pure status transition
    assert.strictEqual(getStores().events.findByType('classification.pass').length, 0);

    const tasks = getStores().loadTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Requeue apply task');
    assert.strictEqual(tasks[0].type, 'bug');
    assert.strictEqual(tasks[0].priority, 'high');
    assert.strictEqual(tasks[0].workflow, 'w_fix');
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
