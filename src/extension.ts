import * as vscode from "vscode";
import { registerOpenWebviewCommand } from "./commands/openWebview";
import { registerViewTasksCommand } from "./commands/viewTasks";
import { registerViewBacklogsCommand } from "./commands/viewBacklogs";
import { addMultipleTasksCommand } from "./commands/addMultipleTasksCommand";
import { registerViewEpicsCommand } from "./commands/viewEpics";
import { registerAddQuicklyCommand } from "./commands/addQuicklyCommand";
import { getWebviewContent } from "./webview/getWebviewContent";
import { SprintsTreeDataProvider } from './sidebar/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './sidebar/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './sidebar/BacklogsTreeDataProvider';

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
    // If this is the epics sidebar, notify the webview to render the epics tree
    if (this.viewId === 'sprintdesk-epics') {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'showEpicsTree' });
      }, 500);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // Register your existing commands
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerViewEpicsCommand(context);
  registerAddQuicklyCommand(context);

  // Register a WebviewViewProvider for each sidebar panel
  for (const viewId of SIDEBAR_VIEW_IDS) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        viewId,
        new SprintDeskSidebarProvider(context, viewId)
      )
    );
  }

  // Register the Sprints tree data provider for the Sprints view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'sprintdesk-sprints',
      new SprintsTreeDataProvider()
    )
  );

  // Register the Backlogs tree data provider for the Backlogs view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'sprintdesk-backlogs',
      new BacklogsTreeDataProvider()
    )
  );

  // Register the Tasks tree data provider for the Tasks view
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        'sprintdesk-tasks',
        new TasksTreeDataProvider(workspaceRoot)
      )
    );
  }

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
  } catch {
    // Doesn't exist → proceed to copy
  }

  try {
    await vscode.workspace.fs.copy(sourceTemplate, destTemplate, { overwrite: false });
    vscode.window.showInformationMessage("📦 SprintDesk folder has been set up in your project!");
  } catch (err) {
    console.error("Failed to copy .SprintDesk:", err);
    // Optional: show error message
    // vscode.window.showErrorMessage("❌ Failed to initialize SprintDesk folder.");
  }
}

export function deactivate() {}