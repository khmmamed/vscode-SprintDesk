import { YAMLStore } from './BaseStore';
import { Approval, ApprovalStatus } from '../types';

export class ApprovalStore extends YAMLStore<Approval> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'approvals.yml', 'approvals', workspaceRoot);
  }

  byStatus(status: ApprovalStatus): Approval[] {
    return this.loadAll().filter(a => a.status === status);
  }

  pending(): Approval[] {
    return this.byStatus('pending').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
}