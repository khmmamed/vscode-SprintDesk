import { YAMLStore } from './BaseStore';
import { EventRule } from '../types';

export class EventRuleStore extends YAMLStore<EventRule> {
  constructor(workspaceRoot?: string) {
    super('database', 'eventRules.yml', 'eventRules', workspaceRoot, 'workforce', 'eventRules.yml');
  }

  loadEnabled(): EventRule[] {
    return this.loadAll().filter(r => r.enabled);
  }
}