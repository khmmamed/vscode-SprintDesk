import * as vscode from 'vscode';

export function registerRefreshCommand(context: vscode.ExtensionContext, deps: { sprintsProvider?: any; backlogsProvider?: any; repositoriesProvider?: any; tasksProvider?: any; epicsProvider?: any; teamProvider?: any; historyProvider?: any }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.refresh', async () => {
    deps.sprintsProvider?.refresh?.();
    deps.backlogsProvider?.refresh?.();
    deps.repositoriesProvider?.refresh?.();
    deps.tasksProvider?.refresh?.();
    deps.epicsProvider?.refresh?.();
    deps.teamProvider?.refresh?.();
    deps.historyProvider?.refresh?.();
    vscode.window.showInformationMessage('SprintDesk refreshed.');
  }));
}
