import * as vscode from 'vscode';
import { addExistingTasksToSprint as defaultAddExisting } from '../../services/sprintService';

export function registerAddExistingTasksToSprintCommand(context: vscode.ExtensionContext, deps: { addExistingTasksToSprint?: (item: any) => Promise<void> }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToSprint', async (item: any) => {
    await deps.addExistingTasksToSprint?.(item) ?? defaultAddExisting(item);
  }));
}
