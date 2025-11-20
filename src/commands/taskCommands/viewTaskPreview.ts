import * as vscode from 'vscode';

export function registerViewTaskPreviewCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('sprintdesk.viewTaskPreview', async (arg) => {
    try {
      // arg may be a TaskTreeItem with resourceUri, a Uri, or a string path
      let uri: vscode.Uri | undefined;
      if (!arg) return;
      if (arg.resourceUri instanceof vscode.Uri) uri = arg.resourceUri;
      else if (arg instanceof vscode.Uri) uri = arg;
      else if (typeof arg === 'string') uri = vscode.Uri.file(arg);

      if (!uri) return;

      // Use built-in markdown preview command
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (err) {
      console.error('Failed to open task preview', err);
      vscode.window.showErrorMessage('Failed to open task preview');
    }
  });

  context.subscriptions.push(disposable);
}
