import { YAMLStore } from './BaseStore';
import { ModelDefinition } from '../types';

/**
 * v1.0 Slice V — the model catalog (.SprintDesk/database/models.yml). Models are
 * registered once and assigned to agents; assigning snapshots the provider fields
 * into the employee's `modelProfile` and records the catalog origin as `modelId`.
 */
export class ModelStore extends YAMLStore<ModelDefinition> {
  constructor(workspaceRoot?: string) {
    super('database', 'models.yml', 'models', workspaceRoot);
  }

  upsert(model: ModelDefinition): ModelDefinition {
    const all = this.loadAll();
    const index = all.findIndex(m => m.id === model.id);
    if (index !== -1) {
      all[index] = model;
    } else {
      all.push(model);
    }
    this.saveAll(all);
    return model;
  }

  findByProviderModel(provider: string, model: string): ModelDefinition | undefined {
    return this.loadAll().find(m => m.provider === provider && m.model === model);
  }
}
