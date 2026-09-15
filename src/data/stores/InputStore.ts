import { YAMLStore } from './BaseStore';
import { InputRecord, InputStatus } from '../types';

const INPUT_ID_PATTERN = /^IN-(\d+)$/;

export class InputStore extends YAMLStore<InputRecord> {
  constructor(workspaceRoot?: string) {
    super('database', 'inputs.yml', 'inputs', workspaceRoot);
  }

  nextId(): string {
    return this.nextIdFromCounter('IN-', INPUT_ID_PATTERN, 6);
  }

  byStatus(status: InputStatus): InputRecord[] {
    return this.loadAll().filter(i => i.status === status);
  }
}