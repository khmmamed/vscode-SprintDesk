import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, makeEmployee, makeRun, makeTask, nextId, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { DEFAULT_QUEUE_SETTINGS } from '../../src/data/types';
import { AuditStore } from '../../src/data/stores/AuditStore';
import { EventRecord, AuditEntry } from '../../src/data/types';

describe('YAML stores', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('persists people to .SprintDesk/people/humans.yml', () => {
    const stores = getStores(ws.root);
    const employee = makeEmployee({ name: 'Persist Me', role: 'human' });
    stores.people.add(employee);

    const reloaded = getStores(ws.root).people;
    assert.strictEqual(reloaded.getById(employee.id)?.name, 'Persist Me');

    const file = path.join(ws.root, '.SprintDesk', 'people', 'humans.yml');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('Persist Me'), 'person should be written to disk');
  });

  it('round-trips run lifecycle updates', () => {
    const stores = getStores(ws.root);
    const employee = makeEmployee();
    stores.people.add(employee);
    const task = makeTask();
    const run = makeRun(task.id, employee.id);

    stores.runs.update(run.id, { status: 'running' });
    assert.strictEqual(stores.runs.getById(run.id)?.status, 'running');

    stores.runs.update(run.id, { status: 'completed', finishedAt: new Date().toISOString() });
    assert.strictEqual(stores.runs.getById(run.id)?.status, 'completed');
    assert.strictEqual(stores.runs.findByTaskId(task.id).length, 1);
    assert.strictEqual(stores.runs.findByAgentId(employee.id).length, 1);
  });

  it('seeds default skills deterministically and idempotently', () => {
    const stores = getStores(ws.root);
    const first = stores.skills.seedDefaultSkills();
    assert.ok(first > 0, 'first seed adds default skills');
    const countAfterFirst = stores.skills.count();
    assert.strictEqual(countAfterFirst, first);

    const second = stores.skills.seedDefaultSkills();
    assert.strictEqual(second, 0, 'second seed must not add duplicates');
    assert.strictEqual(stores.skills.count(), countAfterFirst);
    assert.ok(stores.skills.findByName('typescript'));
  });

  it('events round-trip with latest-first ordering per type filter', () => {
    const stores = getStores(ws.root);
    const base = Date.now();
    const events: EventRecord[] = [
      { id: nextId('evt'), type: 'task.created', source: 'test', payload: { code: 'SPD-1' }, timestamp: new Date(base + 1).toISOString() },
      { id: nextId('evt'), type: 'run.finished', source: 'queue', payload: { runId: 'r1' }, timestamp: new Date(base + 2).toISOString() }
    ];
    for (const ev of events) {
      stores.events.add(ev);
    }
    assert.strictEqual(stores.events.findByType('task.created').length, 1);
    assert.strictEqual(stores.events.latest(1)[0].type, 'run.finished');
    assert.strictEqual(stores.events.findBySource('queue').length, 1);
  });

  it('audit entries round-trip and filter by target', () => {
    const stores = getStores(ws.root);
    const base = Date.now();
    const entries: AuditEntry[] = [
      { id: nextId('audit'), actor: 'queue', action: 'run.start', targetType: 'task', targetId: 't1', timestamp: new Date(base + 1).toISOString() },
      { id: nextId('audit'), actor: 'mcp', action: 'run.finish', targetType: 'task', targetId: 't1', timestamp: new Date(base + 2).toISOString() }
    ];
    for (const entry of entries) {
      stores.audit.add(entry);
    }
    assert.strictEqual(stores.audit.findByTarget('task', 't1').length, 2);
    assert.strictEqual(stores.audit.findByActor('queue').length, 1);
    assert.strictEqual(stores.audit.latest(1)[0].action, 'run.finish');

    const fresh = new AuditStore(ws.root);
    assert.strictEqual(fresh.findByTarget('task').length, 2, 'fresh store reads the same file');
  });

  it('queue settings default and persist across store instances', () => {
    const stores = getStores(ws.root);
    const defaults = stores.queue.getSettings();
    assert.strictEqual(defaults.maxConcurrentRuns, DEFAULT_QUEUE_SETTINGS.maxConcurrentRuns);
    assert.strictEqual(defaults.workerMode, DEFAULT_QUEUE_SETTINGS.workerMode);

    stores.queue.saveSettings({ maxConcurrentRuns: 3, workerMode: 'noop' });
    assert.strictEqual(getStores(ws.root).queue.getSettings().maxConcurrentRuns, 3);
    assert.strictEqual(getStores(ws.root).queue.getSettings().workerMode, 'noop');
  });
});