import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";

export function registerOpenWebviewCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("vscode-react-webview-starter.openWebview", () => {
    const panel = vscode.window.createWebviewPanel("react-webview", "React Webview", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    panel.webview.html = getWebviewContent(context, panel.webview);

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
