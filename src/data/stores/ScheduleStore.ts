import { YAMLStore } from './BaseStore';
import { ScheduleRecord } from '../types';

export class ScheduleStore extends YAMLStore<ScheduleRecord> {
  constructor(workspaceRoot?: string) {
    super('settings', 'schedules.yml', 'schedules', workspaceRoot);
  }

  loadEnabled(): ScheduleRecord[] {
    return this.loadAll().filter(s => s.enabled);
  }

  byKind(kind: ScheduleRecord['kind']): ScheduleRecord[] {
    return this.loadAll().filter(s => s.kind === kind);
  }
}