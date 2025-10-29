import * as vscode from "vscode";
import * as path from "path";
import * as backlogService from "../services/backlogService";
import { getWebviewContent } from "../webview/getWebviewContent";

export function registerViewBacklogsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("sprintdesk.viewBacklogs", async () => {
        const panel = vscode.window.createWebviewPanel(
            "sprintdesk-backlogs",
            "SprintDesk Backlogs",
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const workspaceFolders = vscode.workspace.workspaceFolders;
        let backlogData: { title: string; tasks: string[] }[] = [];

        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            const summaries = backlogService.listBacklogsSummary(rootPath);
            backlogData = summaries.map(s => ({ title: s.title, tasks: s.tasks.map(t => t.label) }));
        }

        panel.webview.html = getWebviewContent(context, panel.webview);
        setTimeout(() => {
            panel.webview.postMessage({
                command: "SET_BACKLOGS",
                payload: backlogData,
            });
        }, 500);
    });

    context.subscriptions.push(disposable);
}
