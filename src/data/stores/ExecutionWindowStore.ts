import { YAMLStore } from './BaseStore';
import { ExecutionWindow } from '../types';

export class ExecutionWindowStore extends YAMLStore<ExecutionWindow> {
  constructor(workspaceRoot?: string) {
    super('database', 'executionWindows.yml', 'executionWindows', workspaceRoot, 'workforce', 'executionWindows.yml');
  }
}