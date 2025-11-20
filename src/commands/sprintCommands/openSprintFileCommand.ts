import * as vscode from 'vscode';

export function registerOpenSprintFileCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.openSprintFile', async (item: any) => {
      const filePath = item?.filePath;
      if (!filePath) {
        vscode.window.showErrorMessage('Sprint file not found for this item.');
        return;
      }
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    })
  );
}
