import * as vscode from "vscode";
import { getWebviewContent } from "../../webview/getWebviewContent";
import { scanSprintDeskFolders } from "./../viewProjects";

export function registerOpenWebviewCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("vscode-react-webview-starter.openWebview", () => {
    const panel = vscode.window.createWebviewPanel("react-webview", "React Webview", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    // Pass view name so the React app can pick up the 'projects' view
    panel.webview.html = getWebviewContent(context, panel.webview, 'projects');

    // On open, scan and send projects data to the webview so TableBlock can render parsed .SprintDesk files
    (async () => {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const projects = await scanSprintDeskFolders(workspaceFolders[0].uri);
          panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projects } });
        } else {
          panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projects: [] } });
        }
      } catch (e) {
        console.error('Failed to scan projects for webview:', e);
        panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projects: [] } });
      }
    })();

    panel.webview.onDidReceiveMessage(
      (message) => {
        const { command, requestId, payload } = message;

        if (command === "GET_DATA") {
          panel.webview.postMessage({ command, requestId, payload: "Hello from the extension!" });
        } else if (command === "GET_DATA_ERROR") {
          panel.webview.postMessage({ command, requestId, error: "Oops, something went wrong!" });
        } else if (command === "POST_DATA") {
          vscode.window.showInformationMessage(`Received data: ${payload.msg}`);
        }
      },
      undefined,
      context.subscriptions
    );
  });

  context.subscriptions.push(disposable);
}
