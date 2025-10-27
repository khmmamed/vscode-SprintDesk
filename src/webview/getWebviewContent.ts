// src/getWebviewContent.ts
import { Uri, Webview, ExtensionContext, ExtensionMode } from "vscode";
import { join } from "path";
import { readFileSync } from "fs";

export function getWebviewContent(context: ExtensionContext, webview: Webview, viewName?: string): string {
  const jsFile = "main.js";
  const localServerUrl = "http://localhost:9001";

  let scriptUrl: string[] = [];
  let cssUrl: string | null = null;

  const isProduction = context.extensionMode === ExtensionMode.Production;
  if (isProduction) {
    const manifest = readFileSync(
      join(context.extensionPath, "dist", "webview", "manifest.json"),
      "utf-8"
    );
    const manifestJson = JSON.parse(manifest);
    for (const [key, value] of Object.entries<string>(manifestJson)) {
      if (key.endsWith(".js")) {
        scriptUrl.push(
          webview
            .asWebviewUri(Uri.file(join(context.extensionPath, "dist", "webview", value)))
            .toString()
        );
      }
    }
  } else {
    scriptUrl.push(`${localServerUrl}/${jsFile}`);
  }

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} ${!isProduction ? localServerUrl : 'https:'}; script-src ${webview.cspSource} ${!isProduction ? localServerUrl : ''} 'unsafe-eval' 'unsafe-inline'; connect-src ${webview.cspSource} ${!isProduction ? localServerUrl : ''}; style-src ${webview.cspSource} 'unsafe-inline';">
      <style>
        body {
          padding: 0;
          margin: 0;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }
        #root {
          height: 100vh;
          width: 100vw;
          overflow: auto;
        }
      </style>
      ${isProduction ? `<link href="${cssUrl}" rel="stylesheet">` : ""}
    </head>
    <body>
      <div id="root"></div>
      <script>
        window.acquireVsCodeApi = acquireVsCodeApi;
        // set view via query string so the React app can pick it up
        (function(){
          try {
            if ("" + ${viewName ? `"${viewName}"` : '""'}) {
              history.replaceState(null, '', '?view=' + ${viewName ? `"${viewName}"` : '""'});
            }
          } catch(e){}
        })();
      </script>
      ${scriptUrl.map((url) => `<script src="${url}"></script>`).join("\n")}
    </body>
    </html>`;
}