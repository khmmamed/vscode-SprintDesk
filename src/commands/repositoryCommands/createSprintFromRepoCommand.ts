import * as vscode from 'vscode';
import * as path from 'path';
import { getDataService } from '../../data/DataService';
import { Sprint } from '../../data/types';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateSprintFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createSprintFromRepo', async (item: any) => {
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
        const startDate = await vscode.window.showInputBox({
          prompt: 'Enter start date (DD-MM)',
          placeHolder: 'e.g., 11-08'
        });
        if (!startDate) return;

        const endDate = await vscode.window.showInputBox({
          prompt: 'Enter end date (DD-MM)',
          placeHolder: 'e.g., 25-08'
        });
        if (!endDate) return;

        const year = await vscode.window.showInputBox({
          prompt: 'Enter year (YYYY)',
          placeHolder: 'e.g., 2025'
        });
        if (!year) return;

        const dataService = getDataService(repoPath);
        const sprintNumber = dataService.generateNextNumber('sprint');
        const config = dataService.loadConfig();
        const sprintPrefix = config.ids.sprint.prefix;

        const [startDay, startMonth] = startDate.split('-');
        const [endDay, endMonth] = endDate.split('-');
        const yy = year.slice(-2);
        const sprintTitle = `${startDay}-${startMonth}-${yy} → ${endDay}-${endMonth}-${yy}`;
        const sprintName = `[${sprintPrefix}-${sprintNumber}]_${sprintTitle}`;

        const sprint: Sprint = {
          id: require('crypto').randomUUID(),
          number: sprintNumber,
          title: sprintTitle,
          name: sprintName,
          startDate: `${startDay}-${startMonth}-${year}`,
          endDate: `${endDay}-${endMonth}-${year}`,
          status: 'planned',
          tasks: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        sprint.path = path.join(dataService.getSprintsDir(), dataService.getSprintFilename(sprint));

        dataService.addSprint(sprint);
        dataService.saveSprintMd(sprint);

        deps.sprintsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Sprint "${sprintTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create sprint: ${error}`);
      }
    })
  );
}