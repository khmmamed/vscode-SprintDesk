import * as vscode from 'vscode';
import * as path from 'path';
import { promptInput } from '../../utils';
import { getDataService } from '../../data/DataService';
import { Epic } from '../../data/types';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateEpicFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createEpicFromRepo', async (item: any) => {
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
        const epicTitle = await promptInput('Enter epic title', 'New Epic');
        if (!epicTitle) return;

        const category = await promptInput('Enter epic category (e.g., SEO, FE, BE)', 'MISC');
        const epicCategory = category || 'MISC';

        const priorityOptions = [
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' }
        ];
        const selectedPriority = await vscode.window.showQuickPick(priorityOptions, {
          placeHolder: 'Select priority'
        });
        if (!selectedPriority) return;

        const description = await vscode.window.showInputBox({
          prompt: 'Enter epic description (optional)',
          placeHolder: 'Epic description...'
        });

        const dataService = getDataService(repoPath);
        const epicId = require('crypto').randomUUID();
        const epicNumber = dataService.generateNextNumber('epic');
        const epicCode = dataService.generateCode('epic', epicNumber);
        const titleSlug = dataService.slugifyTitle(epicTitle);

        const epic: Epic = {
          id: epicId,
          number: epicNumber,
          code: epicCode,
          name: '',
          title: epicTitle,
          category: epicCategory,
          description: description || '',
          status: 'planned',
          priority: selectedPriority.value as Epic['priority'],
          tasks: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        epic.name = `[${epicCode}]_${epicCategory}_${titleSlug}`;
        epic.path = path.join(dataService.getEpicsDir(), dataService.getEpicFilename(epic));

        dataService.addEpic(epic);
        dataService.saveEpicMd(epic);

        deps.epicsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Epic "${epicTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create epic: ${error}`);
      }
    })
  );
}