import * as vscode from 'vscode';
import * as path from 'path';
import * as taskService from '../../services/taskService';
import { getDataService } from '../../data/DataService';
import { promptInput, PROJECT_CONSTANTS } from '../../utils';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateTaskFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createTaskFromRepo', async (item: any) => {
      if (!item) {
        vscode.window.showErrorMessage('No repository selected');
        return;
      }

      const repoPath = item.fullPath || item.resourceUri?.fsPath;
      if (!repoPath) {
        vscode.window.showErrorMessage('Repository path not found');
        return;
      }

      try {
        const taskTitle = await promptInput('Enter task title', 'New Task');
        if (!taskTitle) return;

        const typeOptions = [
          { label: 'Feature', value: 'feature' },
          { label: 'Bug', value: 'bug' },
          { label: 'Improvement', value: 'improvement' },
          { label: 'Documentation', value: 'documentation' },
          { label: 'Test', value: 'test' }
        ];
        const selectedType = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select task type'
        });
        if (!selectedType) return;

        const priorityOptions = [
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' }
        ];
        const selectedPriority = await vscode.window.showQuickPick(priorityOptions, {
          placeHolder: 'Select priority'
        });
        if (!selectedPriority) return;

        const category = await vscode.window.showInputBox({
          prompt: 'Enter category (optional)',
          placeHolder: 'e.g., frontend, backend'
        });

        const component = await vscode.window.showInputBox({
          prompt: 'Enter component (optional)',
          placeHolder: 'e.g., ui, api'
        });

        const assignee = await vscode.window.showInputBox({
          prompt: 'Enter assignee (optional)',
          placeHolder: 'e.g., John Doe'
        });

        const dataService = getDataService(repoPath);
        const task = taskService.createTask(repoPath, {
          title: taskTitle,
          type: selectedType.value,
          priority: selectedPriority.value,
          status: 'waiting'
        });

        deps.tasksProvider?.refresh?.();

        vscode.window.showInformationMessage(`Task "${taskTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create task: ${error}`);
      }
    })
  );
}