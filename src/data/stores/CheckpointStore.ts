import { YAMLStore } from './BaseStore';
import { Checkpoint } from '../types';

const CHECKPOINT_ID_PATTERN = /^CHK-(\d+)$/;

export class CheckpointStore extends YAMLStore<Checkpoint> {
  constructor(workspaceRoot?: string) {
    super('database', 'checkpoints.yml', 'checkpoints', workspaceRoot);
  }

  nextId(): string {
    return this.nextIdFromCounter('CHK-', CHECKPOINT_ID_PATTERN, 6);
  }

  byPlanId(planId: string): Checkpoint[] {
    return this.loadAll().filter(c => c.planId === planId);
  }
}