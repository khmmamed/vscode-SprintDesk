import * as vscode from "vscode";
import * as taskService from '../../services/taskService';
import * as epicService from '../../services/epicService';

export function addMultipleTasksCommand(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    "sprintdesk.addMultipleTasks",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace opened.");
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      const input = await vscode.window.showInputBox({
        prompt: 'Enter task titles (one per line)',
        placeHolder: 'Task 1\nTask 2\nTask 3'
      });

      if (!input) return;

      const taskLines = input.split('\n').filter(t => t.trim());
      if (taskLines.length === 0) {
        vscode.window.showWarningMessage("No tasks to create.");
        return;
      }

      const createdTasks: string[] = [];
      const errors: string[] = [];

      for (const taskTitle of taskLines) {
        const title = taskTitle.trim();
        if (!title) continue;

        try {
          const task = await taskService.createTask(workspaceRoot, {
            title,
            type: 'feature',
            priority: 'medium',
            status: 'waiting'
          });
          createdTasks.push(task.title);
        } catch (error) {
          errors.push(`Failed: ${title}`);
        }
      }

      let msg = `Created ${createdTasks.length} task(s).`;
      if (errors.length > 0) {
        msg += ` Errors: ${errors.join(', ')}`;
      }
      vscode.window.showInformationMessage(msg);
    }
  );

  context.subscriptions.push(command);
}