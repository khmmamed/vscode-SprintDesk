/**
 * Utility functions for prompting user input in VSCode.
 * version: 0.0.1
 */
import * as vscode from 'vscode';
import { TASK_CONSTANTS, UI_CONSTANTS } from './constant';
export async function promptInput(prompt: string, placeHolder?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt, placeHolder });
}

export async function promptPick<T extends vscode.QuickPickItem>(
  placeHolder: string,
  items: T[]
): Promise<T | undefined> {
  return vscode.window.showQuickPick(items, { placeHolder });
}

export function getTaskTypeOptions() {
  return [
    { label: TASK_CONSTANTS.TYPE.FEATURE, description: 'New functionality', value: 'feature' },
    { label: TASK_CONSTANTS.TYPE.BUG, description: 'Fix an issue', value: 'bug' },
    { label: TASK_CONSTANTS.TYPE.IMPROVEMENT, description: 'Enhancement to existing feature', value: 'improvement' },
    { label: TASK_CONSTANTS.TYPE.DOCUMENTATION, description: 'Documentation updates', value: 'documentation' },
    { label: TASK_CONSTANTS.TYPE.TEST, description: 'Test implementation', value: 'test' }
  ];
}

export function getPriorityOptions() : { label: string; description: string; value: string }[] {
  const emoji = UI_CONSTANTS.EMOJI.PRIORITY;
  return [
    { label: `${emoji.HIGH} High`, description: 'Critical or urgent', value: 'high' },
    { label: `${emoji.MEDIUM} Medium`, description: 'Important but not urgent', value: 'medium' },
    { label: `${emoji.LOW} Low`, description: 'Nice to have', value: 'low' }
  ];
}
