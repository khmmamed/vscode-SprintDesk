import { YAMLStore } from './BaseStore';
import { Run } from '../types';

export class RunStore extends YAMLStore<Run> {
  constructor(workspaceRoot?: string) {
    super('database', 'executions.yml', 'runs', workspaceRoot, 'data', 'runs.yml');
  }

  findByTaskId(taskId: string): Run[] {
    return this.loadAll().filter(r => r.taskId === taskId);
  }

  findByAgentId(agentId: string): Run[] {
    return this.loadAll().filter(r => r.agentId === agentId);
  }

  findByStatus(status: Run['status']): Run[] {
    return this.loadAll().filter(r => r.status === status);
  }
}