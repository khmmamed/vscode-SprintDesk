import * as vscode from "vscode";
import * as fs from 'fs';
import matter from 'gray-matter';
import { registerOpenWebviewCommand } from "./commands/openWebview";
import { registerViewTasksCommand } from "./commands/viewTasks";
import { registerViewBacklogsCommand } from "./commands/viewBacklogs";
import { addMultipleTasksCommand } from "./commands/addMultipleTasksCommand";
import { registerViewEpicsCommand } from "./commands/viewEpics";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerAddQuicklyCommand } from "./commands/addQuicklyCommand";
import { getWebviewContent } from "./webview/getWebviewContent";
import { scanProjectStructure } from "./commands/scanProjectStructure";
import { registerViewProjectStructureCommand } from "./commands/viewProjectStructure";
import { SprintsTreeDataProvider } from './providers/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './providers/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './providers/BacklogsTreeDataProvider';
import { EpicsTreeDataProvider } from './providers/EpicsTreeDataProvider';
import { RepositoriesTreeDataProvider } from './providers/RepositoriesTreeDataProvider';
import { createSprintInteractive } from './services/sprintService';
import { writeTask } from './services/taskService';
import { createEpicInteractive } from './services/epicService';
import { addTaskToBacklogInteractive, addExistingTasksToBacklog } from './services/backlogService';
import { addExistingTasksToSprint, startFeatureFromTask } from './services/sprintService';

import * as path from 'path';
import { createTask } from "./controller/taskController";

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
  // Register project structure scanner command
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.scanProjectStructure', async () => {
      const structure = await scanProjectStructure();
      return structure;
    })
  );

  // Register existing commands
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);
  registerViewProjectStructureCommand(context);

  // Add Sprint: view title button on Sprints
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addSprint', async () => {
    await createSprintInteractive();
  }));

  // Add Task: view title button on Tasks
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTask', async () => {
    await createTask();
    tasksProvider?.refresh(); 
    sprintsProvider.refresh(); 
  }));

  // Add Epic: view title button on Epics
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addEpic', async () => {
    await createEpicInteractive();
  }));

  // Add existing tasks to Sprint: inline on sprint item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToSprint', async (item: any) => {
    await addExistingTasksToSprint(item);
  }));

  // Add Task to Backlog: inline button on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTaskToBacklog', async (item: any) => {
    await addTaskToBacklogInteractive(item);
  }));

  // Add existing tasks to Backlog: inline on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToBacklog', async (item: any) => {
    await addExistingTasksToBacklog(item);
  }));

  // Register the addTaskToEpic command
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.addTaskToEpic', async (params: {
      epicId: string,
      epicPath: string,
      taskId: string,
      taskPath: string
    }) => {
      try {
        if (!fs.existsSync(params.epicPath) || !fs.existsSync(params.taskPath)) {
          throw new Error('Epic or task file not found');
        }

        // Read epic file
        const epicContent = fs.readFileSync(params.epicPath, 'utf8');
        const epicMatter = matter(epicContent);

        // Read task file
        const taskContent = fs.readFileSync(params.taskPath, 'utf8');
        const taskMatter = matter(taskContent);

        // Initialize tasks array if it doesn't exist
        if (!Array.isArray(epicMatter.data.tasks)) {
          epicMatter.data.tasks = [];
        }

        // Create task data object
        const taskData = {
          _id: params.taskId,
          name: taskMatter.data.title || taskMatter.data.name,
          status: taskMatter.data.status || 'not-started',
          file: path.relative(path.dirname(params.epicPath), params.taskPath).replace(/\\/g, '/'),
          description: taskMatter.data.description || '',
          priority: taskMatter.data.priority || 'medium'
        };

        // Check if task already exists
        const existingTaskIndex = epicMatter.data.tasks.findIndex((t: any) => t._id === params.taskId);
        if (existingTaskIndex >= 0) {
          epicMatter.data.tasks[existingTaskIndex] = taskData;
        } else {
          epicMatter.data.tasks.push(taskData);
        }

        // Update epic's task counts
        epicMatter.data.total_tasks = epicMatter.data.tasks.length;
        epicMatter.data.completed_tasks = epicMatter.data.tasks
          .filter((t: any) => t.status === 'done' || t.status === 'completed').length;
        epicMatter.data.progress = Math.round((epicMatter.data.completed_tasks / epicMatter.data.total_tasks) * 100) + '%';

        // Update task list in markdown content
        const taskTableHeader = `| # | Task | Status | Priority | File |
|:--|:-----|:------:|:--------:|:-----|`;

        const taskListSection = epicMatter.data.tasks
          .map((task: any, index: number) => {
            const statusEmoji = getTaskStatusEmoji(task.status);
            const priorityEmoji = getPriorityEmoji(task.priority);
            return `| ${index + 1} | [${task.name}](${task.file}) | ${statusEmoji} ${task.status} | ${priorityEmoji} ${task.priority} | \`${task._id}\` |`;
          })
          .join('\n');

        // Create the complete table with the comment marker at the end
        const taskTable = `${taskTableHeader}\n${taskListSection}\n<!-- Tasks will be added here automatically -->`;

        // Replace task list in content
        const tasksSectionMarker = '## 🧱 Tasks';
        const tasksStart = epicMatter.content.indexOf(tasksSectionMarker);
        if (tasksStart !== -1) {
          // Find the table section
          const tableStart = epicMatter.content.indexOf('| # | Task |', tasksStart);
          const nextSectionMatch = epicMatter.content.slice(tasksStart).match(/\n##\s/);
          const tasksEnd = nextSectionMatch && nextSectionMatch.index !== undefined
            ? tasksStart + nextSectionMatch.index
            : epicMatter.content.length;

          // Insert the new table right after the Tasks header
          epicMatter.content =
            epicMatter.content.slice(0, tasksStart) +
            `${tasksSectionMarker}\n\n${taskTable}\n\n` +
            epicMatter.content.slice(tasksEnd);
        }

        // Helper functions
        function getTaskStatusEmoji(status: string): string {
          switch (status?.toLowerCase()) {
            case 'not-started': return '⏳';
            case 'in-progress': return '🔄';
            case 'done':
            case 'completed': return '✅';
            case 'blocked': return '⛔';
            default: return '⏳';
          }
        }

        function getPriorityEmoji(priority: string): string {
          switch (priority?.toLowerCase()) {
            case 'high': return '🔴';
            case 'low': return '🟢';
            default: return '🟡';
          }
        }

        // Update task's epic reference
        taskMatter.data.epic = {
          _id: params.epicId,
          name: epicMatter.data.title || epicMatter.data.name,
          file: path.relative(path.dirname(params.taskPath), params.epicPath).replace(/\\/g, '/')
        };

        // Write back the files
        fs.writeFileSync(params.epicPath, matter.stringify(epicMatter.content, epicMatter.data));
        fs.writeFileSync(params.taskPath, matter.stringify(taskMatter.content, taskMatter.data));

        // Refresh views
        vscode.window.showInformationMessage(`Added task to epic "${epicMatter.data.title || epicMatter.data.name}"`);
        epicsProvider?.refresh();
        tasksProvider?.refresh();
      } catch (error) {
        vscode.window.showErrorMessage('Failed to add task to epic: ' + (error as Error).message);
      }
    })
  );

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

  // When user selects a repository in the repositories tree, switch the Tasks provider to read from that repo
  repositoriesTreeView.onDidChangeSelection(e => {
    try {
      const sel = (e.selection && e.selection[0]) as any;
      // Try to read our repo path from the selection -- either 'fullPath' (our custom item) or resourceUri
      const repoPath = sel?.fullPath ?? sel?.resourceUri?.fsPath;
      if (repoPath) {
        // Set tasks provider to use this repository root
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tasksProvider as any).setWorkspaceRoot(repoPath);
        tasksProvider.refresh();
        // Optionally refresh other views that should be repo-scoped
        backlogsProvider?.refresh();
        epicsProvider?.refresh();
        sprintsProvider.refresh();
      }
    } catch (err) {
      console.error('Failed to switch tasks provider workspace root on repo selection', err);
    }
  });


  // Refresh command for sidebar trees
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.refresh', async () => {
    sprintsProvider.refresh();
    backlogsProvider?.refresh();
    repositoriesProvider?.refresh();
    tasksProvider?.refresh();
    vscode.window.showInformationMessage('SprintDesk refreshed.');
  }));

  // Start feature from sprint task item
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startFeatureFromTask', async (item: any) => {
      await startFeatureFromTask(item);
    })
  );

  // Open sprint file from sprint item
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.openSprintFile', async (item: any) => {
      const filePath = item?.filePath;
      if (!filePath) {
        vscode.window.showErrorMessage('Sprint file not found for this item.');
        return;
      }
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    })
  );

  // Show sprint calendar days (from sprint file dates)
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.showSprintCalendar', async (item: any) => {
      const filePath = item?.filePath;
      if (!filePath) {
        vscode.window.showErrorMessage('Sprint file not found for this item.');
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const text = Buffer.from(bytes).toString('utf8');
        const iso = /(\d{4})-(\d{2})-(\d{2})/g;
        const dmy = /(\d{2})-(\d{2})-(\d{4})/g;
        const dates: Date[] = [];
        let m: RegExpExecArray | null;
        while ((m = iso.exec(text)) && dates.length < 2) {
          dates.push(new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
        }
        if (dates.length < 2) {
          while ((m = dmy.exec(text)) && dates.length < 2) {
            dates.push(new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
          }
        }
        if (dates.length < 2) {
          vscode.window.showInformationMessage('No sprint date range found in sprint file.');
          return;
        }
        const [start, end] = dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
        const days: string[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          days.push(`${dd}-${mm}-${yyyy}`);
        }
        await vscode.window.showQuickPick(days, {
          title: 'Sprint Days',
          canPickMany: false
        });
      } catch (e) {
        vscode.window.showErrorMessage('Failed to read sprint file dates.');
      }
    })
  );

  // === Auto-copy .SprintDesk template on activation ===
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    // No workspace open → nothing to do
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri;
  const extensionRoot = vscode.Uri.file(context.extensionPath);
  const sourceTemplate = vscode.Uri.joinPath(extensionRoot, "template", ".SprintDesk");
  const destTemplate = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk");

  try {
    // Check if .SprintDesk already exists in the workspace
    await vscode.workspace.fs.stat(destTemplate);
    // If it exists, do nothing
    return;
  } catch { }

  try {
    await vscode.workspace.fs.copy(sourceTemplate, destTemplate, { overwrite: false });
    vscode.window.showInformationMessage("📦 SprintDesk folder has been set up in your project!");
  } catch (err) {
    console.error("Failed to copy .SprintDesk:", err);
  }
}

export function deactivate() { }