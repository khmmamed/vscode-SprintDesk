import { strict as assert } from 'node:assert';
import { makeWorkspace, makeEmployee, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { ModelDefinition } from '../../src/data/types';
import { applyConfigChange } from '../../src/services/workforce/workforceService';
import { setApprovalGate } from '../../src/services/workforce/gates';

function makeModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  const now = new Date().toISOString();
  return {
    id: `model_test_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Local Model',
    provider: 'ollama',
    model: 'gemma2:9b',
    baseUrl: 'http://localhost:11434',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('Model catalog (Slice V)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('persists models to database/models.yml and reloads them', () => {
    const model = makeModel({ name: 'Catalog Model' });
    getStores(ws.root).models.upsert(model);

    const reloaded = getStores(ws.root).models;
    assert.strictEqual(reloaded.getById(model.id)?.name, 'Catalog Model');
    assert.strictEqual(reloaded.findByProviderModel('ollama', 'gemma2:9b')?.id, model.id);
  });

  it('upserts in place and deletes catalog entries', () => {
    const store = getStores(ws.root).models;
    const model = makeModel({ name: 'First' });
    store.upsert(model);
    store.upsert({ ...model, name: 'Renamed' });

    assert.strictEqual(store.count(), 1, 'upsert must not duplicate by id');
    assert.strictEqual(store.getById(model.id)?.name, 'Renamed');

    store.delete(model.id);
    assert.strictEqual(store.count(), 0);
  });

  it('assigns a model to an agent through the config gate and records provenance', () => {
    const stores = getStores(ws.root);
    const agent = makeEmployee({ name: 'Assigned Agent' });
    stores.people.add(agent);

    const result = applyConfigChange(agent.id, {
      modelProfile: { name: agent.name, provider: 'ollama', model: 'gemma2:9b', baseUrl: 'http://localhost:11434' },
      modelId: 'model_abc'
    });

    assert.strictEqual(result.applied, true);
    const updated = getStores(ws.root).people.getById(agent.id);
    assert.strictEqual(updated?.modelProfile?.model, 'gemma2:9b');
    assert.strictEqual(updated?.modelId, 'model_abc');
  });

  it('clears an assigned model through clearModel', () => {
    const stores = getStores(ws.root);
    const agent = makeEmployee({ name: 'Clearable Agent' });
    stores.people.add(agent);
    applyConfigChange(agent.id, {
      modelProfile: { name: agent.name, provider: 'ollama', model: 'gemma2:9b' },
      modelId: 'model_abc'
    });

    const cleared = applyConfigChange(agent.id, { clearModel: true });
    assert.strictEqual(cleared.applied, true);
    const updated = getStores(ws.root).people.getById(agent.id);
    assert.ok(!updated?.modelProfile, 'modelProfile should be cleared');
    assert.ok(!updated?.modelId, 'modelId should be cleared');
  });

  it('respects the manual config-change gate for model assignment', () => {
    setApprovalGate('config-change', 'manual');
    const stores = getStores(ws.root);
    const agent = makeEmployee({ name: 'Gated Agent' });
    stores.people.add(agent);

    const result = applyConfigChange(agent.id, {
      modelProfile: { name: agent.name, provider: 'ollama', model: 'gemma2:9b' },
      modelId: 'model_gated'
    });

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.approvalRequired, true);
    assert.strictEqual(getStores(ws.root).people.getById(agent.id)?.modelId, undefined);
  });
});
