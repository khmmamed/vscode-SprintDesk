import { YAMLStore } from './BaseStore';
import { Plan } from '../types';

const PLAN_ID_PATTERN = /^PLAN-(\d+)$/;

export class PlanStore extends YAMLStore<Plan> {
  constructor(workspaceRoot?: string) {
    super('database', 'plans.yml', 'plans', workspaceRoot);
  }

  nextId(): string {
    return this.nextIdFromCounter('PLAN-', PLAN_ID_PATTERN, 6);
  }

  findRunnable(): Plan[] {
    return this.loadAll().filter(
      p =>
        p.organization.status === 'organized' &&
        p.scheduling.status === 'ready' &&
        p.execution.status === 'unassigned'
    );
  }
}