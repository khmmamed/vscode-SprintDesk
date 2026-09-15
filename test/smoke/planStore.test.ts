import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import {
  Plan,
  InputRecord,
  Cycle,
  Checkpoint,
  Run
} from '../../src/data/types';
import {
  buildPlanMd,
  generatePlanId,
  parseSections,
  planMdPath,
  readPlanMd,
  writePlanMd,
  PlanMdSections
} from '../../src/services/workforce/plan/planService';

const DEFAULT_SECTIONS: PlanMdSections = {
  objective: 'Ship the plan-native runtime',
  implementation: 'Implement storage layout, stores, and services in A–I order.',
  acceptanceCriteria: '- typecheck clean\n- tests green\n- lint 0 errors',
  constraints: 'No Task in the active runtime after Slice I.'
};

function makePlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date().toISOString();
  const id = overrides.id || 'PLAN-000001';
  const plan: Plan = {
    id,
    file: overrides.file || `plans/${id}.md`,
    version: 1,
    lineage: {},
    source: { inputId: 'IN-000001' },
    organization: { status: 'pending', version: 0 },
    classification: {
      original: {
        category: 'feature',
        urgency: 'normal',
        priority: 'medium',
        complexity: 'medium',
        risk: 'medium',
        executionMode: 'immediate'
      }
    },
    scheduling: { status: 'draft', mode: 'immediate', dependsOn: [] },
    execution: { status: 'unassigned' },
    validation: { decision: 'passed', errors: [], artifacts: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  return plan;
}

function makeInput(overrides: Partial<InputRecord> = {}): InputRecord {
  return {
    id: 'IN-000001',
    file: 'inputs/IN-000001.md',
    status: 'new',
    source: { type: 'human', id: 'me' },
    ingestedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 'CY-000001',
    inputIds: ['IN-000001'],
    planIds: [],
    executionIds: [],
    organizationPasses: 0,
    startedAt: new Date().toISOString(),
    outcome: 'open',
    ...overrides
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'CHK-000001',
    planId: 'PLAN-000001',
    artifacts: ['validator/report.md'],
    status: 'ready',
    ...overrides
  };
}

describe('v1.0.0 Slice A — plan domain, stores & storage layout', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('round-trips plans through .SprintDesk/database/plans.yml', () => {
    const stores = getStores(ws.root);
    const plan = makePlan({ id: 'PLAN-000042', organization: { status: 'pending', version: 0 } });
    stores.plans.add(plan);

    const reloaded = getStores(ws.root).plans.getById('PLAN-000042');
    assert.ok(reloaded);
    assert.strictEqual(reloaded.file, 'plans/PLAN-000042.md');
    assert.strictEqual(reloaded.organization.status, 'pending');
    assert.strictEqual(reloaded.classification.original.category, 'feature');

    const file = path.join(ws.root, '.SprintDesk', 'database', 'plans.yml');
    assert.ok(fs.existsSync(file));
    assert.ok(fs.readFileSync(file, 'utf8').includes('PLAN-000042'));
  });

  it('round-trips inputs, cycles and checkpoints into database/', () => {
    const stores = getStores(ws.root);
    const input = makeInput({ id: 'IN-000007' });
    const cycle = makeCycle({ id: 'CY-000007' });
    const checkpoint = makeCheckpoint({ id: 'CHK-000007' });
    stores.inputs.add(input);
    stores.cycles.add(cycle);
    stores.checkpoints.add(checkpoint);

    const fresh = getStores(ws.root);
    assert.strictEqual(fresh.inputs.getById('IN-000007')?.status, 'new');
    assert.strictEqual(fresh.cycles.open().length, 1);
    assert.strictEqual(fresh.checkpoints.byPlanId('PLAN-000001').length, 1);

    assert.ok(fs.existsSync(path.join(ws.root, '.SprintDesk', 'database', 'inputs.yml')));
    assert.ok(fs.existsSync(path.join(ws.root, '.SprintDesk', 'database', 'cycles.yml')));
    assert.ok(fs.existsSync(path.join(ws.root, '.SprintDesk', 'database', 'checkpoints.yml')));
  });

  it('allocates sequential PLAN ids against the persisted registry', () => {
    const stores = getStores(ws.root);
    assert.strictEqual(stores.plans.nextId(), 'PLAN-000001');
    stores.plans.add(makePlan({ id: stores.plans.nextId() }));
    assert.strictEqual(stores.plans.nextId(), 'PLAN-000002');

    assert.strictEqual(stores.inputs.nextId(), 'IN-000001');
    assert.strictEqual(stores.cycles.nextId(), 'CY-000001');
    assert.strictEqual(stores.checkpoints.nextId(), 'CHK-000001');
  });

  it('generatePlanId follows the same repository counter', () => {
    assert.strictEqual(generatePlanId(ws.root), 'PLAN-000001');
    getStores(ws.root).plans.add(makePlan({ id: generatePlanId(ws.root) }));
    assert.strictEqual(generatePlanId(ws.root), 'PLAN-000002');
  });

  it('writes and reads plan markdown preserving body sections', () => {
    const plan = makePlan({ id: 'PLAN-000009', version: 2 });
    getStores(ws.root).plans.add(plan);
    const written = writePlanMd(plan, DEFAULT_SECTIONS, ws.root);
    assert.strictEqual(written, planMdPath(plan.id, ws.root));
    assert.ok(fs.existsSync(written));

    const parsed = readPlanMd(written);
    assert.strictEqual(parsed.id, plan.id);
    assert.strictEqual(parsed.version, 2);
    assert.deepStrictEqual(parsed.lineage, {});
    assert.strictEqual(parsed.sections.objective, DEFAULT_SECTIONS.objective);
    assert.strictEqual(parsed.sections.acceptanceCriteria, DEFAULT_SECTIONS.acceptanceCriteria);
    assert.strictEqual(parsed.raw, fs.readFileSync(written, 'utf8'));
  });

  it('front-matter id/version/lineage round-trip through the markdown', () => {
    const plan = makePlan({
      id: 'PLAN-000010',
      version: 3,
      lineage: { supersedes: 'PLAN-000008', planIds: ['PLAN-000008'] }
    });
    writePlanMd(plan, DEFAULT_SECTIONS, ws.root);

    const parsed = readPlanMd(planMdPath(plan.id, ws.root));
    assert.strictEqual(parsed.id, 'PLAN-000010');
    assert.strictEqual(parsed.version, 3);
    assert.deepStrictEqual(parsed.lineage, plan.lineage);
  });

  it('parseSections resolves the four plan sections from raw content', () => {
    const md = buildPlanMd(makePlan({ id: 'PLAN-000011' }), DEFAULT_SECTIONS);
    const sections = parseSections(md);
    assert.strictEqual(sections.objective, DEFAULT_SECTIONS.objective);
    assert.strictEqual(sections.implementation, DEFAULT_SECTIONS.implementation);
    assert.strictEqual(sections.acceptanceCriteria, DEFAULT_SECTIONS.acceptanceCriteria);
    assert.strictEqual(sections.constraints, DEFAULT_SECTIONS.constraints);
  });

  it('relocated RunStore reads legacy .SprintDesk/data/runs.yml data back', () => {
    const stores = getStores(ws.root);
    const employee = makeEmployee();
    stores.people.add(employee);
    const now = new Date().toISOString();

    // Simulate a pre-v1.0 workspace: legacy runs state, no database/ copy yet.
    fs.rmSync(path.join(ws.root, '.SprintDesk', 'database', 'executions.yml'), { force: true });
    fs.mkdirSync(path.join(ws.root, '.SprintDesk', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(ws.root, '.SprintDesk', 'data', 'runs.yml'),
      `runs:\n- id: run_legacy_1\n  taskId: task_1\n  agentId: ${employee.id}\n  status: queued\n  attempts: 1\n  createdAt: ${now}\n  updatedAt: ${now}\n`,
      'utf8'
    );

    const reloaded = getStores(ws.root).runs;
    const legacy: Run | undefined = reloaded.getById('run_legacy_1');
    assert.ok(legacy);
    assert.strictEqual(legacy.taskId, 'task_1');

    // The first write moves state to database/executions.yml (internal key `runs`).
    reloaded.update('run_legacy_1', { status: 'running' });
    const executionsFile = path.join(ws.root, '.SprintDesk', 'database', 'executions.yml');
    assert.ok(fs.existsSync(executionsFile));
    assert.ok(fs.readFileSync(executionsFile, 'utf8').includes('run_legacy_1'));
    assert.strictEqual(getStores(ws.root).runs.getById('run_legacy_1')?.status, 'running');
  });

  it('event and audit state lives under .SprintDesk/database/ only', () => {
    const stores = getStores(ws.root);
    stores.events.add({
      id: 'evt_plan_1',
      type: 'plan.created',
      source: 'test',
      payload: { planId: 'PLAN-000001' },
      timestamp: new Date().toISOString()
    });
    stores.audit.add({
      id: 'audit_plan_1',
      actor: 'test',
      action: 'plan.create',
      targetType: 'plan',
      targetId: 'PLAN-000001',
      timestamp: new Date().toISOString()
    });

    assert.ok(fs.existsSync(path.join(ws.root, '.SprintDesk', 'database', 'events.yml')));
    assert.ok(fs.existsSync(path.join(ws.root, '.SprintDesk', 'database', 'audit.yml')));
    assert.ok(!fs.existsSync(path.join(ws.root, '.SprintDesk', 'data', 'events.yml')));
    assert.ok(!fs.existsSync(path.join(ws.root, '.SprintDesk', 'data', 'audit.yml')));
  });

  it('storage invariant: all new-seeded state stores live under database/', () => {
    for (const file of ['inputs.yml', 'plans.yml', 'cycles.yml', 'checkpoints.yml', 'executions.yml', 'events.yml', 'audit.yml']) {
      const dbPath = path.join(ws.root, '.SprintDesk', 'database', file);
      assert.ok(fs.existsSync(dbPath), `${file} should be seeded under database/`);
      assert.ok(!fs.existsSync(path.join(ws.root, '.SprintDesk', 'data', file)), `${file} must not live under data/`);
    }
  });
});