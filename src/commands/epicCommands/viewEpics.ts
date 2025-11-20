import * as vscode from "vscode";
import * as path from "path";
import * as epicService from "../../services/epicService";
import { getWebviewContent } from "../../webview/getWebviewContent";

export function registerViewEpicsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("sprintdesk.viewEpics", async () => {
        const panel = vscode.window.createWebviewPanel(
            "sprintdesk-epics",
            "SprintDesk Epics",
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const workspaceFolders = vscode.workspace.workspaceFolders;
        let epicData: { title: string; tasks: string[]; rawContent: string }[] = [];

        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            const mdFiles = epicService.listEpics(rootPath);

            for (const file of mdFiles) {
                try {
                    const content = epicService.readEpic(file);

                    // Get title from first markdown heading or filename
                    let titleMatch = content.match(/^#\s+(.+)$/m);
                    let title = titleMatch ? titleMatch[1].trim() : path.basename(file, ".md");

                    // Extract the section under '## tasks'
                    const tasksSectionMatch = content.match(/## tasks\s*([\s\S]*)/i);
                    let tasks: string[] = [];

                    if (tasksSectionMatch) {
                        const tasksSection = tasksSectionMatch[1];
                        const lines = tasksSection.split("\n");

                        for (const line of lines) {
                            const trimmed = line.trim();

                            if (trimmed === "" || trimmed.startsWith("#")) {
                                break;
                            }

                            if (trimmed.startsWith("- ")) {
                                const match = trimmed.match(/- .*?\[\s*([^\]]+)\s*\]/);
                                if (match) {
                                    tasks.push(match[1].trim());
                                }
                            } else {
                                break;
                            }
                        }
                    }

                    epicData.push({ title, tasks, rawContent: content });
                } catch (e) {
                    // optionally log error here
                }
            }
        }

        panel.webview.html = getWebviewContent(context, panel.webview);
        setTimeout(() => {
            panel.webview.postMessage({
                command: "SET_EPICS",
                payload: epicData,
            });
        }, 500);
    });

    context.subscriptions.push(disposable);
}
