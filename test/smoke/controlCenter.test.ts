import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeEmployee, makePlan, makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { DEFAULT_TOOLS } from '../../src/data/stores/ToolStore';

describe('Control Center sidebar sections (Slice T)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  const sd = (): string => path.join(ws.root, '.SprintDesk');

  it('seeds default tools into database/tools.yml deterministically and idempotently', () => {
    const stores = getStores(ws.root);
    const first = stores.tools.seedDefaultTools();
    assert.equal(first, DEFAULT_TOOLS.length, 'first seed adds every default tool');
    assert.equal(stores.tools.count(), DEFAULT_TOOLS.length);

    const second = stores.tools.seedDefaultTools();
    assert.equal(second, 0, 'second seed must not add duplicates');
    assert.equal(stores.tools.count(), DEFAULT_TOOLS.length);

    const file = path.join(sd(), 'database', 'tools.yml');
    assert.ok(fs.existsSync(file), 'tools.yml must be written under database/');
    assert.match(fs.readFileSync(file, 'utf8'), /name: git/);
  });

  it('resolves a tool by name or alias and lists names sorted', () => {
    const stores = getStores(ws.root);
    stores.tools.seedDefaultTools();
    assert.equal(stores.tools.findByName('git')?.id, 'tool_git');
    assert.equal(stores.tools.findByName('node')?.id, 'tool_npm', 'alias resolves to the tool');
    assert.equal(stores.tools.findByName('  GIT  ')?.id, 'tool_git', 'lookup trims and is case-insensitive');
    const names = stores.tools.personToolNames();
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  it('round-trips optional agent mcps/tools capability refs', () => {
    const stores = getStores(ws.root);
    const employee = makeEmployee({ role: 'agent', mcps: ['mcp_a', 'mcp_b'], tools: ['git', 'docker'] });
    stores.people.add(employee);

    const reloaded = getStores(ws.root).people.getById(employee.id);
    assert.deepEqual(reloaded?.mcps, ['mcp_a', 'mcp_b']);
    assert.deepEqual(reloaded?.tools, ['git', 'docker']);
  });

  it('creates no parallel Plan storage for the categorized views', () => {
    const stores = getStores(ws.root);
    stores.tools.seedDefaultTools();
    stores.skills.seedDefaultSkills();
    const plan = makePlan();

    const forbidden = ['findings', 'approvals', 'schedules', 'workflows', 'activity'].flatMap(dir => [
      path.join(sd(), dir, 'Plans.yml'),
      path.join(sd(), dir, 'plans.yml'),
      path.join(sd(), 'database', dir, 'Plans.yml')
    ]);
    for (const candidate of forbidden) {
      assert.ok(!fs.existsSync(candidate), `categorized views must not create parallel Plan storage: ${candidate}`);
    }

    assert.equal(stores.plans.getById(plan.id)?.id, plan.id, 'the canonical PlanStore stays authoritative');

    const databaseEntries = fs.readdirSync(path.join(sd(), 'database')).sort();
    assert.ok(databaseEntries.includes('tools.yml'), 'Slice T adds tools.yml');
    assert.ok(databaseEntries.includes('plans.yml'), 'the canonical plans.yml remains');
  });
});
