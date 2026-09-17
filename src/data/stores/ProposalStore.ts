import { YAMLStore } from './BaseStore';
import { TaskProposal, TaskProposalStatus } from '../types';

export class ProposalStore extends YAMLStore<TaskProposal> {
  constructor(workspaceRoot?: string) {
    super('database', 'classification.yml', 'proposals', workspaceRoot, 'workforce', 'classification.yml');
  }

  byStatus(status: TaskProposalStatus): TaskProposal[] {
    return this.loadAll().filter(p => p.status === status);
  }

  byFindingId(findingId: string): TaskProposal | undefined {
    return this.loadAll().find(p => p.findingId === findingId);
  }
}