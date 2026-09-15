import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import {
  listInputs,
  ingestInput,
  orchestrate,
  createPlan,
  inputsDir,
  OrchestrationUnit,
  normalizeText,
  DiscoveredInput
} from '../../src/services/workforce/orchestrator';
import { planMdPath, readPlanMd } from '../../src/services/workforce/plan/planService';
import { LLMProvider } from '../../src/services/workforce/llm/types';
import { Plan, InputRecord } from '../../src/data/types';

function writeInput(ws: TestWorkspace, name: string, data: Record<string, unknown>, body: string): string {
  const dir = path.join(ws.root, '.SprintDesk', 'inputs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, matter.stringify(body, data), 'utf8');
  return file;
}

function fakeProvider(units: Array<Record<string, unknown>>): LLMProvider {
  return {
    kind: 'ollama' as never,
    async chat() {
      return { text: JSON.stringify(units) };
    }
  };
}

function garbageProvider(): LLMProvider {
  return {
    kind: 'ollama' as never,
    async chat() {
      return { text: 'this is not json at all' };
    }
  };
}

describe('v1.0.0 Slice B — Orchestrator', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('discovers unregistered inputs by name + content hash', () => {
    writeInput(ws, 'a.md', { title: 'Alpha' }, 'alpha body');
    fs.mkdirSync(inputsDir(ws.root), { recursive: true });
    fs.writeFileSync(path.join(inputsDir(ws.root), 'readme.txt'), 'not an input', 'utf8');

    const discovered: DiscoveredInput[] = listInputs(ws.root);
    assert.strictEqual(discovered.length, 1);
    assert.strictEqual(discovered[0].name, 'a.md');
    assert.ok(discovered[0].contentHash.length > 0);
    assert.ok(discovered[0].mtimeMs > 0);
    assert.ok(discovered[0].size > 0);

    const input = ingestInput(discovered[0].path, { source: { type: 'human', id: 'me' } });
    assert.strictEqual(listInputs(ws.root).length, 0);

    // An edited file is a NEW input (name is unchanged, content hash differs).
    fs.appendFileSync(path.join(inputsDir(ws.root), 'a.md'), '\n# changed', 'utf8');
    assert.strictEqual(listInputs(ws.root).length, 1);
    assert.notStrictEqual(listInputs(ws.root)[0].contentHash, input.contentHash);
  });

  it('ingests an input into InputStore and opens its cycle (idempotent)', () => {
    const file = writeInput(ws, 'task.md', { title: 'Triage' }, 'body');
    const input = ingestInput(file, { source: { type: 'agent', id: 'emp_1' } });
    assert.ok(input.id.startsWith('IN-'));
    assert.strictEqual(input.status, 'new');
    assert.strictEqual(input.file, 'inputs/task.md');
    assert.deepStrictEqual(input.plannedFrom, []);
    assert.strictEqual(input.contentHash?.length, 40);
    assert.deepStrictEqual(input.source, { type: 'agent', id: 'emp_1' });

    const stores = getStores(ws.root);
    assert.ok(stores.inputs.getById(input.id));
    const cycles = stores.cycles.open();
    assert.strictEqual(cycles.length, 1);
    assert.ok(cycles[0].inputIds.includes(input.id));
    assert.strictEqual(cycles[0].outcome, 'open');

    const eventTypes = stores.events.loadAll().map(e => e.type);
    assert.ok(eventTypes.includes('input.created'));
    assert.ok(eventTypes.includes('cycle.opened'));
    assert.ok(stores.events.loadAll().every(e => e.source === 'orchestrator'));

    // Same file, same content — idempotent.
    const again = ingestInput(file, { source: { type: 'human' } });
    assert.strictEqual(again.id, input.id);
  });

  it('deterministically decomposes a multi-unit input and writes plan markdown', async () => {
    const file = writeInput(ws, 'multi.md', {
      plans: [
        {
          title: 'Add timeout handling',
          objective: 'Make the pipeline tolerate slow steps without hanging',
          implementation: 'Wrap each step in a timeout and surface the failure.',
          category: 'bug',
          urgency: 'urgent'
        },
        {
          title: 'Archive expired cache',
          objective: 'Remove cache entries older than 24 hours',
          executionMode: 'async'
        }
      ]
    }, 'ignored body');
    const input = ingestInput(file);

    const result = await orchestrate(input.id);
    assert.strictEqual(result.plans.length, 2);
    assert.strictEqual(result.skipped.length, 0);

    const stores = getStores(ws.root);
    const first: Plan | undefined = stores.plans.getById('PLAN-000001');
    const second: Plan | undefined = stores.plans.getById('PLAN-000002');
    assert.ok(first && second);
    assert.strictEqual(first.classification.original.category, 'bug');
    assert.strictEqual(first.classification.original.urgency, 'urgent');
    assert.strictEqual(first.classification.current, undefined);
    assert.strictEqual(second.classification.original.category, 'feature');
    assert.strictEqual(second.classification.original.executionMode, 'async');

    const written = planMdPath(first.id, ws.root);
    assert.ok(fs.existsSync(written));
    const parsed = readPlanMd(written);
    assert.strictEqual(parsed.id, first.id);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.sections.objective, 'Make the pipeline tolerate slow steps without hanging');

    const reloaded: InputRecord | undefined = stores.inputs.getById(input.id);
    assert.strictEqual(reloaded?.status, 'planned');
    assert.deepStrictEqual(reloaded?.plannedFrom, ['PLAN-000001', 'PLAN-000002']);

    const cycle = stores.cycles.open()[0];
    assert.deepStrictEqual(cycle.planIds, ['PLAN-000001', 'PLAN-000002']);

    const events = stores.events.loadAll().map(e => e.type);
    assert.strictEqual(events.filter(t => t === 'plan.created').length, 2);
    assert.ok(events.includes('input.planned'));
  });

  it('is idempotent per input — dedup by normalized objective', async () => {
    const file = writeInput(ws, 'idem.md', {
      plans: [
        { title: 'A', objective: '  Make the  build deterministic ' },
        { title: 'B', objective: 'Add telemetry to the runner' }
      ]
    }, '');
    const input = ingestInput(file);
    assert.strictEqual((await orchestrate(input.id)).plans.length, 2);

    const second = await orchestrate(input.id);
    assert.strictEqual(second.plans.length, 0);
    assert.deepStrictEqual(second.skipped.map(s => s.reason), ['duplicate', 'duplicate']);
    assert.strictEqual(getStores(ws.root).plans.loadAll().length, 2);

    const rewritten = writeInput(ws, 'idem2.md', {
      objective: 'make the BUILD deterministic'
    }, '');
    const input2 = ingestInput(rewritten);
    const third = await orchestrate(input2.id);
    assert.strictEqual(third.plans.length, 0);
    assert.strictEqual(third.skipped[0]?.reason, 'duplicate');
    assert.strictEqual(normalizeText('  Make the  build deterministic '), normalizeText('make the BUILD deterministic'));
  });

  it('honors maxPlansPerPass cap and resumes on the next pass', async () => {
    const file = writeInput(ws, 'capped.md', {
      plans: ['One', 'Two', 'Three', 'Four'].map(n => ({ title: `Plan ${n}`, objective: `Objective for ${n}` }))
    }, '');
    const input = ingestInput(file);

    const passOne = await orchestrate(input.id, { maxPlansPerPass: 2 });
    assert.strictEqual(passOne.plans.length, 2);
    assert.deepStrictEqual(passOne.skipped.map(s => s.reason), ['cap', 'cap']);

    // Pass two: units 1-2 dedup against the plans already created,
    // units 3-4 are created (still bounded by the cap).
    const passTwo = await orchestrate(input.id, { maxPlansPerPass: 2 });
    assert.strictEqual(passTwo.plans.length, 2);
    assert.deepStrictEqual(passTwo.skipped.map(s => s.reason), ['duplicate', 'duplicate']);

    const all = getStores(ws.root).plans.loadAll();
    assert.deepStrictEqual(all.map(p => p.id), ['PLAN-000001', 'PLAN-000002', 'PLAN-000003', 'PLAN-000004']);
  });

  it('uses the LLM decomposition path with a providerOverride (gated)', async () => {
    const file = writeInput(ws, 'llm.md', {}, 'Decompose this whole input into plan units.');
    const input = ingestInput(file);

    const result = await orchestrate(input.id, {
      providerOverride: fakeProvider([
        { title: 'Alpha', objective: 'Alpha objective', category: 'bug' },
        { title: 'Beta', objective: 'Beta objective', executionMode: 'sync' }
      ])
    });
    assert.strictEqual(result.plans.length, 2);

    const stores = getStores(ws.root);
    const alpha: Plan | undefined = stores.plans.getById('PLAN-000001');
    assert.ok(alpha);
    assert.strictEqual(alpha.classification.original.category, 'bug');
    assert.strictEqual(readPlanMd(planMdPath(alpha.id, ws.root)).sections.objective, 'Alpha objective');
    assert.ok(fs.existsSync(planMdPath('PLAN-000002', ws.root)));
  });

  it('falls back to deterministic decomposition when the LLM path yields nothing', async () => {
    const file = writeInput(ws, 'llm2.md', {
      title: 'Fallback target',
      objective: 'Keep planning even when the model is unhelpful'
    }, 'The implementation details live here.');
    const input = ingestInput(file);

    const result = await orchestrate(input.id, { providerOverride: garbageProvider() });
    assert.strictEqual(result.plans.length, 1);
    const plan = getStores(ws.root).plans.getById(result.plans[0].id);
    assert.ok(plan);
    assert.strictEqual(readPlanMd(planMdPath(plan.id, ws.root)).sections.objective, 'Keep planning even when the model is unhelpful');
  });

  it('derives a single plan from title/objective front-matter', async () => {
    const file = writeInput(ws, 'single.md', {
      title: 'Fix the pipeline',
      objective: 'Make the build pipeline deterministic',
      category: 'bug',
      urgency: 'urgent',
      risk: 'high'
    }, 'Fix the flaky stage.\n\nEnsure re-runs are reproducible.');
    const input = ingestInput(file);

    const result = await orchestrate(input.id);
    assert.strictEqual(result.plans.length, 1);
    const plan = getStores(ws.root).plans.getById(result.plans[0].id);
    assert.ok(plan);
    assert.strictEqual(plan.classification.original.category, 'bug');
    assert.strictEqual(plan.classification.original.urgency, 'urgent');
    assert.strictEqual(plan.classification.original.risk, 'high');
    assert.strictEqual(plan.classification.original.priority, 'medium');

    const sections = readPlanMd(planMdPath(plan.id, ws.root)).sections;
    assert.strictEqual(sections.implementation, 'Fix the flaky stage.');
  });

  it('createPlan never writes classification.current and keeps lineage/source', () => {
    const unit: OrchestrationUnit = {
      title: 'Direct',
      objective: 'Create a plan directly through the content path'
    };
    const plan = createPlan('IN-000001', unit, { workspaceRoot: ws.root });
    assert.strictEqual(plan.source.inputId, 'IN-000001');
    assert.strictEqual(plan.classification.original.executionMode, 'immediate');
    assert.strictEqual(plan.classification.current, undefined);
    assert.deepStrictEqual(plan.lineage, {});
    assert.strictEqual(plan.organization.status, 'pending');
    assert.ok(fs.existsSync(planMdPath(plan.id, ws.root)));
  });

  it('bound the pass by the queue settings maxPlansPerPass when not overridden', async () => {
    // default is 5 (DEFAULT_QUEUE_SETTINGS); nothing overrides it here
    assert.strictEqual(getStores(ws.root).queue.getSettings().maxPlansPerPass, 5);
  });
});