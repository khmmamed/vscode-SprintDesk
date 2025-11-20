import * as vscode from 'vscode';
import { addTaskToBacklogInteractive as defaultAddTask } from '../../services/backlogService';

export function registerAddTaskToBacklogCommand(context: vscode.ExtensionContext, deps: { addTaskToBacklogInteractive?: (item: any) => Promise<void> }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTaskToBacklog', async (item: any) => {
    await deps.addTaskToBacklogInteractive?.(item) ?? defaultAddTask(item);
  }));
}
