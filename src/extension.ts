import * as vscode from "vscode";
import { registerOpenWebviewCommand } from "./commands/openWebview";
import { registerViewTasksCommand } from "./commands/viewTasks";
import { registerViewBacklogsCommand } from "./commands/viewBacklogs";
import { addMultipleTasksCommand } from "./commands/addMultipleTasksCommand";
import { registerViewEpicsCommand } from "./commands/viewEpics";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerAddQuicklyCommand } from "./commands/addQuicklyCommand";
import { getWebviewContent } from "./webview/getWebviewContent";
import { scanGitProjects } from "./commands/scanGitProjects";
import { registerViewGitProjectsCommand } from "./commands/viewGitProjects";
import { scanProjectStructure } from "./commands/scanProjectStructure";
import { registerViewProjectStructureCommand } from "./commands/viewProjectStructure";
import { SprintsTreeDataProvider } from './sidebar/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './sidebar/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './sidebar/BacklogsTreeDataProvider';
import * as tasksService from './services/tasksService';
import * as path from 'path';

// existing tasks dir helper moved to services/fileService

const SIDEBAR_VIEW_IDS = [
  "sprintdesk-sprints",
  "sprintdesk-backlogs",
  "sprintdesk-epics",
  "sprintdesk-tasks"
];

class SprintDeskSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly viewId: string) {}

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

  // Register git projects scanner command
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.scanGitProjects', async () => {
      const projects = await scanGitProjects();
      return projects || [];
    })
  );

  // Register existing commands
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerViewEpicsCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);
  registerViewGitProjectsCommand(context);
  registerViewProjectStructureCommand(context);

  // Add Sprint: view title button on Sprints
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addSprint', async () => {
    await tasksService.addSprint();
  }));

  // Add Task: view title button on Tasks
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTask', async () => {
    await tasksService.createTaskAndLink();
  }));

  // Add Epic: view title button on Epics
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addEpic', async () => {
    await tasksService.addEpic();
  }));

  // Add existing tasks to Sprint: inline on sprint item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToSprint', async (item: any) => {
    await tasksService.addExistingTasksToSprint(item);
  }));

  // Add Task to Backlog: inline button on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTaskToBacklog', async (item: any) => {
    await tasksService.addTaskToBacklog(item);
  }));

  // Add existing tasks to Backlog: inline on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToBacklog', async (item: any) => {
    await tasksService.addExistingTasksToBacklog(item);
  }));

  // Register WebviewViewProviders
  for (const viewId of SIDEBAR_VIEW_IDS) {
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
  const tasksProvider = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
    ? new TasksTreeDataProvider(vscode.workspace.workspaceFolders[0].uri.fsPath)
    : undefined;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sprintdesk-sprints', sprintsProvider)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sprintdesk-backlogs', backlogsProvider)
  );
  if (tasksProvider) {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('sprintdesk-tasks', tasksProvider)
    );
  }

  // Refresh command for sidebar trees
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.refresh', async () => {
    sprintsProvider.refresh();
    backlogsProvider.refresh();
    tasksProvider?.refresh();
    vscode.window.showInformationMessage('SprintDesk refreshed.');
  }));

  // Start feature from sprint task item
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startFeatureFromTask', async (item: any) => {
      await tasksService.startFeatureFromTask(item);
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
  } catch {}

  try {
    await vscode.workspace.fs.copy(sourceTemplate, destTemplate, { overwrite: false });
    vscode.window.showInformationMessage("📦 SprintDesk folder has been set up in your project!");
  } catch (err) {
    console.error("Failed to copy .SprintDesk:", err);
  }
}

function insertTaskLinkUnderSection(content: string, section: string, taskLink: string): string {
  const sectionRegex = new RegExp(`(^|\n)##\\s*${section}[^\n]*\n`, 'i');
  const match = content.match(sectionRegex);
  if (match) {
    const insertPos = match.index! + match[0].length;
    const nextSection = content.slice(insertPos).search(/^##\\s+/m);
    if (nextSection === -1) {
      const before = content.slice(0, insertPos);
      const after = content.slice(insertPos);
      if (after.includes(taskLink)) return content;
      return before + (after.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    } else {
      const before = content.slice(0, insertPos + nextSection);
      const after = content.slice(insertPos + nextSection);
      if (before.includes(taskLink)) return content;
      return before + (before.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    }
  } else {
    if (content.includes(taskLink)) return content;
    return content.trimEnd() + `\n\n## ${section}\n${taskLink}\n`;
  }
}

export function deactivate() {}