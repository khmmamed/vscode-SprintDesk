import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// webview
import { getWebviewContent } from "./webview/getWebviewContent";
// commands
import {
  registerAddSprintCommand,
  registerAddExistingTasksToSprintCommand,
  registerShowSprintCalendarCommand,
  registerOpenSprintFileCommand,
  registerAddBacklogCommand,
  registerAddTaskToBacklogCommand,
  registerAddExistingTasksToBacklogCommand,
  registerAddEpicCommand,
  registerAddTaskToEpicCommand,
  registerAddQuicklyCommand,
  registerStartFeatureFromTaskCommand,
  registerCreateTaskFromRepoCommand,
  registerCreateEpicFromRepoCommand,
  registerCreateSprintFromRepoCommand,
  registerCreateBacklogFromRepoCommand,
  registerOpenWebviewCommand,
  registerViewTasksCommand,
  registerViewTaskPreviewCommand,
  registerEditTaskRawCommand,
  registerViewEpicsCommand,
  registerViewBacklogsCommand,
  addMultipleTasksCommand,
  registerAddTaskCommand
} from './commands';
import { registerViewProjectStructureCommand } from "./commands/viewProjectStructure";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerRefreshCommand } from './commands/refreshCommand';
import { registerScanProjectStructureCommand } from './commands/scanProjectStructureCommand';
import {
  registerOpenSettingsCommand
} from './commands';
// Provider
import { SprintsTreeDataProvider } from './providers/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './providers/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './providers/BacklogsTreeDataProvider';
import { EpicsTreeDataProvider } from './providers/EpicsTreeDataProvider';
import { RepositoriesTreeDataProvider } from './providers/RepositoriesTreeDataProvider';
// Services
import { createSprintInteractive } from './services/sprintService';
import { createEpicInteractive } from './services/epicService';
import { addTaskToBacklogInteractive, addExistingTasksToBacklog, createBacklogInteractive } from './services/backlogService';
import { addExistingTasksToSprint, startFeatureFromTask } from './services/sprintService';
// Tasks - import and create wrapper for API compatibility
import { createTask as createTaskService } from "./services/taskService";

const createTask = async (repoPath?: string): Promise<void> => {
  const ws = repoPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Task title',
    placeHolder: 'Enter task title...'
  });
  if (!title) return;

  const type = await vscode.window.showQuickPick(['feature', 'bug', 'chore', 'doc', 'test'], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  const priority = await vscode.window.showQuickPick(['high', 'medium', 'low'], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  const backlog = await vscode.window.showInputBox({
    prompt: 'Backlog name',
    placeHolder: 'features',
    value: 'features'
  });

  // Get existing epics for selection
  const { getDataService } = require('./data/DataService');
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();

  let epicSelection: string | undefined;
  if (epics.length > 0) {
    const epicOptions = [{ label: '(None)', value: null }, ...epics.map((e: any) => ({
      label: `[${e.code}] ${e.title}`,
      value: e.id
    }))];

    const selectedEpic = await vscode.window.showQuickPick(epicOptions, {
      placeHolder: 'Select epic (optional)'
    });
    epicSelection = selectedEpic?.value ?? null;
  }

  await createTaskService(ws, {
    title,
    type,
    status: 'waiting',
    priority,
    backlog: backlog || 'features',
    epic: epicSelection
  });

  vscode.window.showInformationMessage(`Task "${title}" created.`);
};

// existing tasks dir helper moved to services/fileService

const SIDEBAR_VIEW_IDS = [
  "sprintdesk-sprints",
  "sprintdesk-backlogs",
  "sprintdesk-epics",
  "sprintdesk-tasks"
];

class SprintDeskSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly viewId: string) { }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        this.context.extensionUri
      ]
    };
    webviewView.webview.html = getWebviewContent(this.context, webviewView.webview);
    if (this.viewId === 'sprintdesk-epics') {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'showEpicsTree' });
      }, 500);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // Register existing commands (delegated to `src/commands`)
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewTaskPreviewCommand(context);
  registerEditTaskRawCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);
  registerViewProjectStructureCommand(context);
  registerViewEpicsCommand(context);

  // Register WebviewViewProviders for non-tree views
  const treeViewIds = ['sprintdesk-repositories', 'sprintdesk-epics', 'sprintdesk-tasks', 'sprintdesk-sprints', 'sprintdesk-backlogs'];
  const webviewIds = SIDEBAR_VIEW_IDS.filter(id => !treeViewIds.includes(id));

  for (const viewId of webviewIds) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        viewId,
        new SprintDeskSidebarProvider(context, viewId)
      )
    );
  }

  // Tree providers
  const sprintsProvider = new SprintsTreeDataProvider();
  const backlogsProvider = new BacklogsTreeDataProvider();
  const repositoriesProvider = new RepositoriesTreeDataProvider();

  const tasksProvider = new TasksTreeDataProvider();
  const epicsProvider = new EpicsTreeDataProvider();

  // Create and register sprints tree view with drag and drop support
  const sprintsTreeView = vscode.window.createTreeView('sprintdesk-sprints', {
    treeDataProvider: sprintsProvider,
    dragAndDropController: sprintsProvider
  });
  context.subscriptions.push(sprintsTreeView);

  const backlogsTreeView = vscode.window.createTreeView('sprintdesk-backlogs', {
    treeDataProvider: backlogsProvider,
    dragAndDropController: backlogsProvider
  });
  context.subscriptions.push(backlogsTreeView);

  const epicsTreeView = vscode.window.createTreeView('sprintdesk-epics', {
    treeDataProvider: epicsProvider,
    dragAndDropController: epicsProvider
  });
  context.subscriptions.push(epicsTreeView);

  const tasksTreeView = vscode.window.createTreeView('sprintdesk-tasks', {
    treeDataProvider: tasksProvider,
    dragAndDropController: tasksProvider
  });
  context.subscriptions.push(tasksTreeView);

  const repositoriesTreeView = vscode.window.createTreeView('sprintdesk-repositories', {
    treeDataProvider: repositoriesProvider
  });
  context.subscriptions.push(repositoriesTreeView);

  // Register delegated commands (one file per command)
  registerAddTaskCommand(context, { repositoriesTreeView, createTask, tasksProvider, sprintsProvider });
  registerScanProjectStructureCommand(context);
  registerAddSprintCommand(context, { createSprintInteractive });
  registerAddEpicCommand(context, { createEpicInteractive, epicsProvider });
  registerAddExistingTasksToSprintCommand(context, { addExistingTasksToSprint });
  registerAddBacklogCommand(context, { createBacklogInteractive });
  registerAddTaskToBacklogCommand(context, { addTaskToBacklogInteractive });
  registerAddExistingTasksToBacklogCommand(context, { addExistingTasksToBacklog });
  registerAddTaskToEpicCommand(context, { epicsProvider, tasksProvider });

  // Register repository commands
  registerCreateTaskFromRepoCommand(context, { repositoriesTreeView, tasksProvider, sprintsProvider, epicsProvider, backlogsProvider });
  registerCreateEpicFromRepoCommand(context, { repositoriesTreeView, epicsProvider, tasksProvider, sprintsProvider, backlogsProvider });
  registerCreateSprintFromRepoCommand(context, { repositoriesTreeView, sprintsProvider, tasksProvider, epicsProvider, backlogsProvider });
  registerCreateBacklogFromRepoCommand(context, { repositoriesTreeView, backlogsProvider, tasksProvider, sprintsProvider, epicsProvider });
  registerRefreshCommand(context, { sprintsProvider, backlogsProvider, repositoriesProvider, tasksProvider, epicsProvider });
  registerStartFeatureFromTaskCommand(context, { startFeatureFromTask });
  registerOpenSprintFileCommand(context);
  registerShowSprintCalendarCommand(context);

  // Settings commands
  registerOpenSettingsCommand(context);

  // When user selects a repository in the repositories tree, switch the Tasks provider to read from that repo
  repositoriesTreeView.onDidChangeSelection(e => {
    try {
      const sel = (e.selection && e.selection[0]) as any;
      // Try to read our repo path from the selection -- either 'fullPath' (our custom item) or resourceUri
      let selectedPath = sel?.fullPath ?? sel?.resourceUri?.fsPath;
      let repoPath: string | undefined = undefined;
      if (selectedPath) {
        const path = require('path');
        // If the selected path is a repo node or category, it already points to the repo root
        if (sel?.nodeType === 'repo' || sel?.nodeType === 'category') {
          repoPath = sel.fullPath || sel.resourceUri?.fsPath;
        } else {
          // File node selected: try to locate the repository root by trimming at the .SprintDesk segment
          const parts = String(selectedPath).split(path.sep);
          const sdIndex = parts.indexOf('.SprintDesk');
          if (sdIndex > 0) {
            repoPath = parts.slice(0, sdIndex).join(path.sep);
          } else {
            // fallback: assume parent 3 levels up (repo/.SprintDesk/<category>/file.md)
            repoPath = path.resolve(selectedPath, '..', '..', '..');
          }
        }
      }

      // If a repository is selected, set override; if selection is empty, clear override
      if (repoPath) {
        // Persist override to fileService so services also pick it up
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fileService = require('./services/fileService');
        fileService.setWorkspaceRootOverride(repoPath);

        // Update all providers that support setWorkspaceRoot
        try { (tasksProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (backlogsProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (epicsProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (sprintsProvider as any).setWorkspaceRoot(repoPath); } catch { }
      } else {
        const fileService = require('./services/fileService');
        fileService.setWorkspaceRootOverride(undefined);
        try { (tasksProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (backlogsProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (epicsProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (sprintsProvider as any).setWorkspaceRoot(undefined); } catch { }
      }
    } catch (err) {
      console.error('Failed to switch tasks provider workspace root on repo selection', err);
    }
  });

  // === Ensure .SprintDesk folder structure on activation ===
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const ws = workspaceFolders[0].uri.fsPath;
    const sdPath = path.join(ws, '.SprintDesk');

    // Ensure all directories exist
    const dirs = ['data', 'Tasks', 'Backlogs', 'Epics', 'Sprints'];
    for (const dir of dirs) {
      const fullPath = path.join(sdPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // Ensure data files exist
    const dataFiles = ['tasks.yml', 'backlogs.yml', 'epics.yml', 'sprints.yml'];
    for (const file of dataFiles) {
      const dataPath = path.join(sdPath, 'data', file);
      if (!fs.existsSync(dataPath)) {
        const key = file.replace('.yml', '');
        fs.writeFileSync(dataPath, `${key}: []`, 'utf8');
      }
    }

    vscode.window.showInformationMessage("📦 SprintDesk ready!");
  } catch (err) {
    console.error('Failed to create SprintDesk folder structure:', err);
  }
}

export function deactivate() { }