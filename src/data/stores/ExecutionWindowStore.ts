import { YAMLStore } from './BaseStore';
import { ExecutionWindow } from '../types';

export class ExecutionWindowStore extends YAMLStore<ExecutionWindow> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'executionWindows.yml', 'executionWindows', workspaceRoot);
  }
}