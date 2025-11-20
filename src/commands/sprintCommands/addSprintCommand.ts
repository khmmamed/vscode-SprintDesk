import * as vscode from 'vscode';

export function registerAddSprintCommand(context: vscode.ExtensionContext, deps: { createSprintInteractive?: () => Promise<void> }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addSprint', async () => {
    await deps.createSprintInteractive?.();
  }));
}
