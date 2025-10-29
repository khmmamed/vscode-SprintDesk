import * as vscode from 'vscode';
import * as path from 'path';
import * as taskService from '../services/taskService';
import * as epicService from '../services/epicService';
import * as backlogService from '../services/backlogService';
import insertTaskLinkUnderSection from '../utils/mdUtils';

export function registerAddQuicklyCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('sprintdesk.addQuickly', async () => {
    const input = await vscode.window.showInputBox({
      prompt: "Enter: '@task task name @epic epic name @backlog backlog name'",
      placeHolder: "@task My Task @epic My Epic @backlog My Backlog"
    });
    if (!input) {
      return;
    }

    // Parse input
    const taskMatch = input.match(/@task ([^@]+)/);
    const epicMatch = input.match(/@epic ([^@]+)/);
    const backlogMatch = input.match(/@backlog ([^@]+)/);
    const taskName = taskMatch ? taskMatch[1].trim() : undefined;
    const epicName = epicMatch ? epicMatch[1].trim() : undefined;
    const backlogName = backlogMatch ? backlogMatch[1].trim() : undefined;

    if (!taskName) {
      vscode.window.showErrorMessage('Task name (@task) is required.');
      return;
    }

    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const root = workspaceFolders[0].uri.fsPath;

    // Create task via TaskService (creates folders/files as needed)
    let fileName: string;
    try {
      const res = taskService.createTask({
        title: taskName,
        type: 'feature',
        priority: 'medium',
        status: 'not-started',
        epicName: epicName,
        epicId: epicName ? `epic_${epicName.replace(/\s+/g, '_').toLowerCase()}` : undefined
      });
      fileName = res.fileName;
    } catch (e) {
      vscode.window.showErrorMessage('Failed to create task.');
      return;
    }

    // Link to epic using EpicService
    if (epicName) {
      try {
        await epicService.addTaskToEpic(epicName, fileName as any);
      } catch (e) {
        // fallback: ensure epic file exists
        epicService.createEpic(epicName);
      }
    }

    // Add to backlog if specified
    if (backlogName) {
      const backlogs = backlogService.listBacklogs(root);
      const match = backlogs.find(b => path.basename(b).toLowerCase().includes(backlogName.toLowerCase()));
      if (!match) {
        vscode.window.showErrorMessage(`No backlog file found matching '${backlogName}'.`);
      } else {
        const backlogContent = backlogService.readBacklog(match);
        const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${fileName})`;
        const newContent = insertTaskLinkUnderSection(backlogContent, 'tasks', taskLink);
        backlogService.updateBacklog(match, newContent);
      }
    }

    vscode.window.showInformationMessage('Task created and linked successfully!');
  });

  context.subscriptions.push(disposable);
}
