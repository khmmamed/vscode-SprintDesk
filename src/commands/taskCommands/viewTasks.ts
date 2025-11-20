import * as vscode from "vscode";
import { getWebviewContent } from "../../webview/getWebviewContent";
import { getAllTaskRows, TaskRow } from "../../utils/taskUtils";

export function registerViewTasksCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("sprintdesk.viewTasks", async () => {
    const panel = vscode.window.createWebviewPanel("sprintdesk-tasks", "SprintDesk Tasks", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    const workspaceFolders = vscode.workspace.workspaceFolders;
    let taskRows: TaskRow[] = [];
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath;
      taskRows = getAllTaskRows(rootPath);
    }

    panel.webview.html = getWebviewContent(context, panel.webview);

    setTimeout(() => {
      panel.webview.postMessage({
        command: "SET_TASKS",
        payload: taskRows,
      });
    }, 500);
  });

  context.subscriptions.push(disposable);
}
