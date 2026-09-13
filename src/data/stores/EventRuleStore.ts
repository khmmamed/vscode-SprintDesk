import { YAMLStore } from './BaseStore';
import { EventRule } from '../types';

export class EventRuleStore extends YAMLStore<EventRule> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'eventRules.yml', 'eventRules', workspaceRoot);
  }

  loadEnabled(): EventRule[] {
    return this.loadAll().filter(r => r.enabled);
  }
}