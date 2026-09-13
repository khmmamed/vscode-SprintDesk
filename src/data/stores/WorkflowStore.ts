import { YAMLStore } from './BaseStore';
import { WorkflowDefinition } from '../types';

export class WorkflowStore extends YAMLStore<WorkflowDefinition> {
  constructor(workspaceRoot?: string) {
    super('settings', 'workflows.yml', 'workflows', workspaceRoot);
  }

  loadEnabled(): WorkflowDefinition[] {
    return this.loadAll().filter(w => w.enabled);
  }

  byName(name: string): WorkflowDefinition | undefined {
    return this.loadAll().find(w => w.name === name);
  }

  byId(id: string): WorkflowDefinition | undefined {
    return this.loadAll().find(w => w.id === id);
  }
}