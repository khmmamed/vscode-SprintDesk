import * as vscode from 'vscode';

export function registerEditTaskRawCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('sprintdesk.editTaskRaw', async (arg) => {
    try {
      let uri: vscode.Uri | undefined;
      if (!arg) return;
      if (arg.resourceUri instanceof vscode.Uri) uri = arg.resourceUri;
      else if (arg instanceof vscode.Uri) uri = arg;
      else if (typeof arg === 'string') uri = vscode.Uri.file(arg);

      if (!uri) return;

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      console.error('Failed to open task for editing', err);
      vscode.window.showErrorMessage('Failed to open task for editing');
    }
  });

  context.subscriptions.push(disposable);
}
