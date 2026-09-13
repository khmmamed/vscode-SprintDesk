import { YAMLStore } from './BaseStore';
import { Finding, FindingStatus } from '../types';

export class FindingStore extends YAMLStore<Finding> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'findings.yml', 'findings', workspaceRoot);
  }

  byStatus(status: FindingStatus): Finding[] {
    return this.loadAll().filter(f => f.status === status);
  }

  pending(): Finding[] {
    return this.byStatus('pending').sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }

  byRunId(runId: string): Finding[] {
    return this.loadAll().filter(f => f.source?.runId === runId);
  }
}