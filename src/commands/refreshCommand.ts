import * as vscode from 'vscode';

export function registerRefreshCommand(context: vscode.ExtensionContext, deps: { historyProvider?: any; workforceProvider?: any }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.refresh', async () => {
    deps.historyProvider?.refresh?.();
    deps.workforceProvider?.refresh?.();
    vscode.window.showInformationMessage('SprintDesk refreshed.');
  }));
}
