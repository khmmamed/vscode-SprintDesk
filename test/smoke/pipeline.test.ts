import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { makeWorkspace, TestWorkspace, makeEmployee } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { runIntakePass } from '../../src/services/workforce/intake/intakeService';
import {
  isPipelineEligible,
  runPendingPipelines
} from '../../src/services/workforce/pipeline/planPipeline';
import { materializePlan, readPlanMd } from '../../src/services/workforce/plan/planService';
import {
  assignTeamRole,
  seedOrchestratorTeam
} from '../../src/services/workforce/orchestration/roles';
import { Plan } from '../../src/data/types';

function writeInput(ws: TestWorkspace, name: string, data: Record<string, unknown>, body = ''): string {
  const dir = path.join(ws.root, '.SprintDesk', 'inputs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, matter.stringify(body, data), 'utf8');
  return file;
}

function planFile(ws: TestWorkspace, plan: Pick<Plan, 'file'>): string {
  return path.join(ws.root, '.SprintDesk', plan.file);
}

function stageEvents(ws: TestWorkspace): string[] {
  return getStores(ws.root).events.loadAll()
    .filter(e => e.type === 'plan.pipeline.stage')
    .map(e => String(e.payload.stage));
}

describe('v1.1 Slice W — staged plan refinement pipeline', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('refines a Request plan through classifier → organizer → scheduler to ready', async () => {
    seedOrchestratorTeam(ws.root);
    writeInput(ws, 'IN-TEST-000001.md', {
      title: 'Refined plan',
      objective: 'A pipeline refines the plan artifact'
    });

    await runIntakePass({ workspaceRoot: ws.root });

    const plan = getStores(ws.root).plans.loadAll()[0];
    assert.strictEqual(plan.pipeline?.stage, 'ready');
    const stages = plan.pipeline?.history.map(r => r.stage) || [];
    assert.ok(stages.includes('classifier'), 'classifier stage recorded');
    assert.ok(stages.includes('organizer'), 'organizer stage recorded');
    assert.ok(stages.includes('ready'), 'ready stage recorded');

    const md = readPlanMd(planFile(ws, plan));
    assert.strictEqual(md.pipeline, 'ready');
    assert.ok(md.sections.classification?.includes('Category:'), 'classification section written');
    assert.ok(md.sections.breakdown, 'breakdown section written');
    assert.ok(md.sections.dependencies, 'dependencies section written');
    assert.ok(md.sections.assignment, 'assignment section written');
    assert.ok(md.sections.executionPlan?.includes('Status:'), 'execution plan section written');

    const types = getStores(ws.root).events.loadAll().map(e => e.type);
    assert.ok(types.includes('plan.pipeline.stage'), 'stage events emitted');
    assert.ok(types.includes('plan.ready'), 'terminal ready event emitted');
    assert.deepStrictEqual(stageEvents(ws).slice(-1), ['ready']);
  });

  it('is idempotent — a second pass rewrites nothing and emits no new stage events', async () => {
    seedOrchestratorTeam(ws.root);
    writeInput(ws, 'IN-TEST-000002.md', { title: 'Stable', objective: 'Runs once, then settles' });

    await runIntakePass({ workspaceRoot: ws.root });
    const plan = getStores(ws.root).plans.loadAll()[0];
    const firstContent = fs.readFileSync(planFile(ws, plan), 'utf8');
    const firstHistory = plan.pipeline?.history.length;
    const firstStageEvents = stageEvents(ws).length;

    const second = await runIntakePass({ workspaceRoot: ws.root });

    const after = getStores(ws.root).plans.loadAll()[0];
    assert.strictEqual(fs.readFileSync(planFile(ws, after), 'utf8'), firstContent);
    assert.strictEqual(after.pipeline?.history.length, firstHistory);
    assert.strictEqual(stageEvents(ws).length, firstStageEvents);
    assert.strictEqual(second.organizer.changed, 0);
  });

  it('excludes synthetic and proposal-origin plans from the pipeline', () => {
    const synthetic = materializePlan(
      { sourceInputId: 'synthetic:workflow:wf-1', title: 'Workflow plan', description: 'step' },
      { workspaceRoot: ws.root }
    );
    const proposal = materializePlan(
      { sourceInputId: 'proposal:PROP-000001', title: 'Proposal plan', description: 'p' },
      { workspaceRoot: ws.root }
    );

    assert.strictEqual(isPipelineEligible(synthetic), false);
    assert.strictEqual(isPipelineEligible(proposal), false);

    const result = runPendingPipelines({ workspaceRoot: ws.root });
    void result;

    const plans = getStores(ws.root).plans.loadAll();
    assert.ok(plans.every(p => p.pipeline === undefined), 'no pipeline runs for excluded plans');
    assert.strictEqual(plans.length, 2);
  });

  it('falls back to deterministic refinement when the assigned agent model is unreachable', async () => {
    const team = seedOrchestratorTeam(ws.root);
    const classifier = makeEmployee({
      name: 'Classifier Bot',
      modelProfile: {
        name: 'broken',
        provider: 'ollama',
        model: 'nope',
        baseUrl: 'http://127.0.0.1:1',
        options: { timeoutMs: 150 }
      }
    });
    getStores(ws.root).people.add(classifier);
    assignTeamRole(team.id, 'classifier', classifier.id, ws.root);

    writeInput(ws, 'IN-TEST-000003.md', { title: 'Fallback', objective: 'Model is offline' });
    await runIntakePass({ workspaceRoot: ws.root });

    const plan = getStores(ws.root).plans.loadAll()[0];
    assert.strictEqual(plan.pipeline?.stage, 'ready');
    const classifierRecord = plan.pipeline?.history.find(r => r.stage === 'classifier');
    assert.strictEqual(classifierRecord?.source, 'deterministic');
    assert.strictEqual(classifierRecord?.by, classifier.id);
  });
});
