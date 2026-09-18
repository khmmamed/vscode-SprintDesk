import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { makeWorkspace, TestWorkspace, makeEmployee } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { ingestInput } from '../../src/services/workforce/orchestrator';
import {
  installIntakeEventTriggers,
  runIntakePass
} from '../../src/services/workforce/intake/intakeService';
import {
  ORCHESTRATION_ROLES,
  assignTeamRole,
  getOrchestratorTeam,
  memberForRole,
  roleMemberId,
  seedOrchestratorTeam
} from '../../src/services/workforce/orchestration/roles';

function writeInput(ws: TestWorkspace, name: string, data: Record<string, unknown>, body = ''): string {
  const dir = path.join(ws.root, '.SprintDesk', 'inputs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, matter.stringify(body, data), 'utf8');
  return file;
}

function eventTypes(ws: TestWorkspace): string[] {
  return getStores(ws.root).events.loadAll().map(e => e.type);
}

describe('v1.1 Slice U — Orchestrator team & automatic intake', () => {
  let ws: TestWorkspace;
  let disposeTriggers: (() => void) | undefined;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    if (disposeTriggers) {
      disposeTriggers();
      disposeTriggers = undefined;
    }
    ws.cleanup();
  });

  it('seeds the Orchestrator team with all eight roles idempotently', () => {
    const first = seedOrchestratorTeam(ws.root);
    assert.strictEqual(first.name, 'Orchestrator');
    assert.deepStrictEqual(first.memberIds, []);
    assert.deepStrictEqual(first.roles?.map(r => r.role), [...ORCHESTRATION_ROLES]);
    assert.ok(first.roles?.every(r => r.memberId === undefined));

    const second = seedOrchestratorTeam(ws.root);
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(getStores(ws.root).teams.loadAll().length, 1);
    assert.strictEqual(second.roles?.length, ORCHESTRATION_ROLES.length);
  });

  it('runs one intake pass: ingest → plan → organize → schedule decision (execution gated)', async () => {
    seedOrchestratorTeam(ws.root);
    writeInput(ws, 'IN-TEST-000001.md', {
      title: 'Automatic intake',
      objective: 'A dropped Request file becomes exactly one Plan'
    });

    const result = await runIntakePass({ workspaceRoot: ws.root });

    const stores = getStores(ws.root);
    const inputs = stores.inputs.loadAll();
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].status, 'planned');
    assert.strictEqual(result.ingested.length, 1);

    const plans = stores.plans.loadAll();
    assert.strictEqual(plans.length, 1);
    assert.deepStrictEqual(inputs[0].plannedFrom, [plans[0].id]);

    const types = eventTypes(ws);
    for (const expected of [
      'input.created',
      'orchestration.reader.completed',
      'orchestration.classifier.completed',
      'orchestration.planner.completed',
      'plan.created',
      'orchestration.organizer.completed',
      'orchestration.scheduler.evaluated'
    ]) {
      assert.ok(types.includes(expected), `missing lifecycle event ${expected}`);
    }

    // queueSettings.enabled defaults to false — no worker execution.
    assert.strictEqual(result.queueEnabled, false);
    assert.ok(!types.includes('run.started'));
    assert.ok(!types.includes('run.queued'));
    const decision = stores.events.loadAll().find(e => e.type === 'orchestration.scheduler.evaluated');
    assert.strictEqual(decision?.payload.executionGated, true);
  });

  it('is idempotent — repeated passes create no additional inputs or plans', async () => {
    seedOrchestratorTeam(ws.root);
    writeInput(ws, 'IN-TEST-000002.md', { title: 'Repeatable', objective: 'Second objective' });

    await runIntakePass({ workspaceRoot: ws.root });
    const firstPlans = getStores(ws.root).plans.loadAll().length;
    const planCreatedEvents = eventTypes(ws).filter(t => t === 'plan.created').length;

    const second = await runIntakePass({ workspaceRoot: ws.root });
    assert.deepStrictEqual(second.ingested, []);
    assert.deepStrictEqual(second.planned, {});

    const stores = getStores(ws.root);
    assert.strictEqual(stores.inputs.loadAll().length, 1);
    assert.strictEqual(stores.plans.loadAll().length, firstPlans);
    assert.strictEqual(eventTypes(ws).filter(t => t === 'plan.created').length, planCreatedEvents);
  });

  it('reacts to the input.created event path', async () => {
    seedOrchestratorTeam(ws.root);
    disposeTriggers = installIntakeEventTriggers();

    const file = writeInput(ws, 'IN-TEST-000003.md', { title: 'Event driven', objective: 'Triggered by input.created' });
    ingestInput(file, { source: { type: 'human' }, workspaceRoot: ws.root });

    await new Promise(resolve => setTimeout(resolve, 60));

    const stores = getStores(ws.root);
    assert.strictEqual(stores.plans.loadAll().length, 1);
    assert.strictEqual(stores.inputs.loadAll()[0].status, 'planned');
  });

  it('records the assigned role member on stage events and clears it cleanly', async () => {
    const team = seedOrchestratorTeam(ws.root);
    const reader = makeEmployee({ name: 'Reader Bot' });
    getStores(ws.root).people.add(reader);

    assignTeamRole(team.id, 'reader', reader.id, ws.root);
    assert.strictEqual(roleMemberId(getOrchestratorTeam(ws.root), 'reader'), reader.id);
    assert.strictEqual(memberForRole('reader', ws.root)?.id, reader.id);

    writeInput(ws, 'IN-TEST-000004.md', { title: 'Attribution', objective: 'Stage events name the reader' });
    await runIntakePass({ workspaceRoot: ws.root });

    const readerEvent = getStores(ws.root).events.loadAll().find(e => e.type === 'orchestration.reader.completed');
    assert.strictEqual(readerEvent?.payload.memberId, reader.id);

    assignTeamRole(team.id, 'reader', undefined, ws.root);
    assert.strictEqual(roleMemberId(getOrchestratorTeam(ws.root), 'reader'), undefined);
  });
});
