import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";
import path from "path";
import glob from "glob";

export function registerViewTasksCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("sprintdesk.viewTasks", async () => {
    const panel = vscode.window.createWebviewPanel("sprintdesk-tasks", "SprintDesk Tasks", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    const workspaceFolders = vscode.workspace.workspaceFolders;
    let taskRows: { task: string; epic: string; file: string }[] = [];
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const tasksFolder = path.join(rootPath, ".SprintDesk", "🚀_tasks");
      const mdFiles = glob.sync("**/*.md", { cwd: tasksFolder, absolute: true });

      for (const file of mdFiles) {
        try {
          const base = path.basename(file);
          const match = base.match(/^\[Task\]_(.+)_\[Epic\]_(.+)\.md$/);
          if (match) {
            taskRows.push({
              task: "🚀 " + match[1].replace(/-/g, " "),
              epic: "🚩 " + match[2].replace(/-/g, " "),
              file: base,
            });
          }
        } catch (e) {}
      }
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
