import { YAMLStore } from './BaseStore';
import { Proposal, ProposalStatus } from '../types';

export class ProposalStore extends YAMLStore<Proposal> {
  constructor(workspaceRoot?: string) {
    super('database', 'classification.yml', 'proposals', workspaceRoot, 'workforce', 'classification.yml');
  }

  byStatus(status: ProposalStatus): Proposal[] {
    return this.loadAll().filter(p => p.status === status);
  }

  byFindingId(findingId: string): Proposal | undefined {
    return this.loadAll().find(p => p.findingId === findingId);
  }
}