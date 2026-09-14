import { YAMLStore } from './BaseStore';
import { TaskProposal, TaskProposalStatus } from '../types';

export class ProposalStore extends YAMLStore<TaskProposal> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'classification.yml', 'proposals', workspaceRoot);
  }

  byStatus(status: TaskProposalStatus): TaskProposal[] {
    return this.loadAll().filter(p => p.status === status);
  }

  byFindingId(findingId: string): TaskProposal | undefined {
    return this.loadAll().find(p => p.findingId === findingId);
  }
}