import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import glob from "glob";
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
            const backlogsFolder = path.join(rootPath, ".SprintDesk", "Backlogs");
            const mdFiles = glob.sync("**/*.md", { cwd: backlogsFolder, absolute: true });

            for (const file of mdFiles) {
                try {
                    const content = fs.readFileSync(file, "utf8");

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
                                // Extract the text inside square brackets after emoji
                                // Regex explanation:
                                // - match a bullet '- '
                                // - then possibly some emoji characters (like 📄)
                                // - then space and '['
                                // - capture anything non-greedy inside brackets '[ ... ]'
                                // Example line: - 📄 [ Refactor GraphQL schema loading](...)
                                const match = trimmed.match(/- .*?\[\s*([^\]]+)\s*\]/);
                                if (match) {
                                    tasks.push(match[1].trim());
                                }
                            } else {
                                break;
                            }
                        }
                    }

                    backlogData.push({ title, tasks });
                } catch (e) {
                    // optionally log error here
                }
            }
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
