import { Uri, Webview, ExtensionContext, ExtensionMode } from "vscode";
import { join } from "path";
import { readFileSync } from "fs";

export function getWebviewContent(context: ExtensionContext, webview: Webview): string {
    const jsFile = "main.bundle.js";
    const localServerUrl = "http://localhost:9000";

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
        ${isProduction ? `<link href="${cssUrl}" rel="stylesheet">` : ""}
        </head>
        <body>
        <div id="root"></div>
        ${scriptUrl.map((url) => `<script src="${url}"></script>`).join("\n")}
        </body>
        </html>
    `;
}
