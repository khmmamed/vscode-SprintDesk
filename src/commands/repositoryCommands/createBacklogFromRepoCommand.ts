import * as vscode from 'vscode';
import * as path from 'path';
import { promptInput } from '../../utils';
import { getDataService } from '../../data/DataService';
import { Backlog } from '../../data/types';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateBacklogFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createBacklogFromRepo', async (item: any) => {
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
        const backlogTitle = await promptInput('Enter backlog title', 'New Backlog');
        if (!backlogTitle) return;

        const typeOptions = [
          { label: 'Features', value: 'features' },
          { label: 'Bugs', value: 'bugs' },
          { label: 'Improvements', value: 'improvements' },
          { label: 'Documentation', value: 'documentation' },
          { label: 'Technical', value: 'technical' },
          { label: 'Tests', value: 'tests' }
        ];
        const selectedType = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select backlog type'
        });
        if (!selectedType) return;

        const dataService = getDataService(repoPath);
        const backlogId = backlogTitle.toUpperCase().trim().replace(/\s+/g, '-');
        
        if (dataService.getBacklog(backlogId)) {
          vscode.window.showWarningMessage(`Backlog "${backlogTitle}" already exists.`);
          return;
        }

        const backlog: Backlog = {
          id: backlogId,
          title: backlogTitle.toUpperCase(),
          name: `[Backlog]_${backlogTitle.toUpperCase()}`,
          description: '',
          tasks: [],
          color: '#2563eb'
        };

        backlog.path = path.join(dataService.getBacklogsDir(), `${backlog.name}.md`);

        dataService.addBacklog(backlog);
        dataService.saveBacklogMd(backlog);

        deps.backlogsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Backlog "${backlogTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create backlog: ${error}`);
      }
    })
  );
}