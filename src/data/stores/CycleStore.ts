import { YAMLStore } from './BaseStore';
import { Cycle } from '../types';

const CYCLE_ID_PATTERN = /^CY-(\d+)$/;

export class CycleStore extends YAMLStore<Cycle> {
  constructor(workspaceRoot?: string) {
    super('database', 'cycles.yml', 'cycles', workspaceRoot);
  }

  nextId(): string {
    return this.nextIdFromCounter('CY-', CYCLE_ID_PATTERN, 6);
  }

  open(): Cycle[] {
    return this.loadAll().filter(c => c.outcome === 'open');
  }

  byPlanId(planId: string): Cycle[] {
    return this.loadAll().filter(c => c.planIds.includes(planId));
  }
}