// src/commands/addMultipleTasksCommand.ts
import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";


// Helper: Extract Epic name
function extractEpic(taskFileName: string): string | null {
  const match = taskFileName.match(/\[Epic\]_([a-zA-Z0-9_-]+)(?=\.md$)/);
  return match ? match[1] : null;
}

// Helper: Extract readable task title
function getTaskTitle(taskFileName: string): string {
  const match = taskFileName.match(/\[Task\]_([^_]+)_\[Epic\]/);
  return match ? match[1].replace(/_/g, " ") : taskFileName.replace(".md", "");
}

export function addMultipleTasksCommand(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    "sprintdesk.addMultipleTasks",
    () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace opened.");
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri;
      const tasksDir = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk", "tasks");
      const epicsDir = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk", "Epics");

      const panel = vscode.window.createWebviewPanel(
        "sprintDeskAddMultipleTasks",
        "➕ Add SprintDesk Tasks",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      const webview = panel.webview;
      const originalHtml = getWebviewContent(context, webview);

      const modifiedHtml = originalHtml.replace(
        "</body>",
        `<script>
          (function() {
            const url = new URL(window.location.toString());
            if (!url.searchParams.has('view')) {
              url.searchParams.set('view', 'addMultipleTasks');
              window.history.replaceState(null, '', url.toString());
            }
          })();
        </script>
        </body>`
      );

      panel.webview.html = modifiedHtml;

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === "validateTasks") {
            const tasks: string[] = message.payload.filter((t: string) => t.trim());

            if (tasks.length === 0) {
              vscode.window.showWarningMessage("No tasks to process.");
              return;
            }

            // Ensure directories exist
            for (const dir of [tasksDir, epicsDir]) {
              try {
                await vscode.workspace.fs.stat(dir);
              } catch {
                await vscode.workspace.fs.createDirectory(dir);
              }
            }

            // Group tasks by Epic
            const epicTasks: Record<string, string[]> = {};
            const createdTasks: string[] = [];
            const skippedTasks: string[] = [];

            // Step 1: Create task files
            for (const rawTask of tasks) {
              const task = rawTask.trim();
              if (!task) continue;

              const safeTaskName = task.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
              const fileName = safeTaskName.endsWith(".md") ? safeTaskName : `${safeTaskName}.md`;
              const fileUri = vscode.Uri.joinPath(tasksDir, fileName);

              // Check if task already exists
              try {
                await vscode.workspace.fs.stat(fileUri);
                skippedTasks.push(fileName);
                continue;
              } catch {
                // Doesn't exist → create
              }

              // Create empty file
              await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(""));
              createdTasks.push(fileName);

              // Group by Epic
              const epic = extractEpic(fileName);
              if (epic) {
                if (!epicTasks[epic]) epicTasks[epic] = [];
                epicTasks[epic].push(fileName);
              }
            }

            // Step 2: Create or update Epic files
            const updatedEpics: string[] = [];
            const now = new Date().toISOString();

            for (const [epic, taskFiles] of Object.entries(epicTasks)) {
              const epicFileName = `[Epic]_${epic}.md`;
              const epicFileUri = vscode.Uri.joinPath(epicsDir, epicFileName);

              // Generate content
              const taskLinks = taskFiles
                .map((taskFile) => {
                  const title = getTaskTitle(taskFile);
                  return `- 📌 [${title}](../tasks/${taskFile})`;
                })
                .join("\n");

              const content = `# 🚩 Epic : ${epic}
- **🗂 updated:** ${now}
- **📌 Tasks:** ${taskFiles.length} tasks
- **📘 Description:** 


## Tasks
${taskLinks}
`;

              // Write file (overwrite if exists)
              await vscode.workspace.fs.writeFile(epicFileUri, new TextEncoder().encode(content));
              updatedEpics.push(epicFileName);
            }

            // Show result
            let msg = `✅ Created ${createdTasks.length} task(s). `;
            if (skippedTasks.length > 0) msg += `❌ Skipped ${skippedTasks.length}. `;
            if (updatedEpics.length > 0) msg += `📘 Updated ${updatedEpics.length} epic(s).`;
            vscode.window.showInformationMessage(msg);
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(command);
}