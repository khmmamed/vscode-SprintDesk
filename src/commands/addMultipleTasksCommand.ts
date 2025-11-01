// src/commands/addMultipleTasksCommand.ts
import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";
import * as epicService from '../services/epicService';
import * as taskService from '../services/taskService';
import { parseTaskMetadataFromFilename } from '../utils/templateUtils';
import { PROJECT, UI } from '../utils/constant';

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

      panel.webview.onDidReceiveMessage(async (message) => {
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

              // Create file using new data approach: generated _id and name (slug), others left empty
              try {
                const { taskName, epicName } = parseTaskMetadataFromFilename(fileName);
                const slug = taskName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
                const generatedId = `tsk_${slug}`;
                const frontmatter = `---\n_id: ${generatedId}\nname: ${slug}\n---\n\n# 🧩 Task: ${taskName}\n`;
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(frontmatter));
                createdTasks.push(fileName);

                // Group by Epic
                if (epicName) {
                  if (!epicTasks[epicName]) epicTasks[epicName] = [];
                  epicTasks[epicName].push(fileName);
                }
              } catch (error) {
                console.error('Error processing task:', error);
                skippedTasks.push(fileName);
              }
            }

            // Step 2: Create or update Epic files
            const updatedEpics: string[] = [];
            const now = new Date().toISOString();

            for (const [epic, taskFiles] of Object.entries(epicTasks) as [string, string[]][]) {
              const epicFileName = `${PROJECT.FILE_PREFIX.EPIC}${epic}.md`;
              const epicFileUri = vscode.Uri.joinPath(epicsDir, epicFileName);

              // Generate content
              const taskLinks = taskFiles
                .map((taskFile) => {
                  const { taskName } = parseTaskMetadataFromFilename(taskFile);
                  return `- ${UI.EMOJI.COMMON.TASK} [${taskName}](../tasks/${taskFile})`;
                })
                .join("\n");

              const content = `# 🚩 Epic : ${epic}
- **🗂 updated:** ${now}
- **📌 Tasks:** ${taskFiles.length} tasks
- **📘 Description:** 


## Tasks
${taskLinks}
`;

              // Write file (overwrite if exists) via EpicService
              const epicFsPath = epicFileUri.fsPath;
              epicService.createEpic(epic);
              epicService.updateEpic(epicFsPath, content);
              updatedEpics.push(epicFileName);
            }

            // Show result
            let msg = `✅ Created ${createdTasks.length} task(s). `;
            if (skippedTasks.length > 0) msg += `❌ Skipped ${skippedTasks.length}. `;
            if (updatedEpics.length > 0) msg += `📘 Updated ${updatedEpics.length} epic(s).`;
            vscode.window.showInformationMessage(msg);
          }
      });
    }
  );

  context.subscriptions.push(command);
}