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
    if (this.viewId === 'sprintdesk-epics') {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'showEpicsTree' });
      }, 500);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerViewEpicsCommand(context);
  registerAddQuicklyCommand(context);

  for (const viewId of SIDEBAR_VIEW_IDS) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        viewId,
        new SprintDeskSidebarProvider(context, viewId)
      )
    );
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'sprintdesk-sprints',
      new SprintsTreeDataProvider()
    )
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'sprintdesk-backlogs',
      new BacklogsTreeDataProvider()
    )
  );

  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        'sprintdesk-tasks',
        new TasksTreeDataProvider(workspaceRoot)
      )
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startFeatureFromTask', async (item: any) => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }
        const workspaceRoot = folders[0].uri.fsPath;

        const taskSlug: string | undefined = item?.taskSlug || item?.label?.toString()?.replace(/\s+/g, '-');
        const taskFilePath: string | undefined = item?.taskFilePath;
        const sprintFilePath: string | undefined = item?.sprintFilePath;
        if (!taskSlug) {
          vscode.window.showErrorMessage('Unable to infer task name.');
          return;
        }

        const terminal = vscode.window.createTerminal({ name: 'SprintDesk: git flow' });
        terminal.show(true);
        terminal.sendText(`cd "${workspaceRoot}"`);
        terminal.sendText(`git flow feature start ${taskSlug}`);

        const dateStr = new Date().toISOString();

        if (taskFilePath) {
          const uri = vscode.Uri.file(taskFilePath);
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString('utf8');
          let updated = text;
          const statusRegex = /(\n- \*\*📍 Status:\*\*.*\n)([\s\S]*)/;
          if (statusRegex.test(text)) {
            updated = text.replace(statusRegex, (_m, head, tail) => `${head}\n- **🟢 Started:** ${dateStr}\n${tail}`);
          } else {
            updated = `${text}\n\n- **🟢 Started:** ${dateStr}\n`;
          }
          await vscode.workspace.fs.writeFile(uri, Buffer.from(updated));
        }

        if (sprintFilePath && item?.taskSlug) {
          const sUri = vscode.Uri.file(sprintFilePath);
          const sBytes = await vscode.workspace.fs.readFile(sUri);
          const sText = Buffer.from(sBytes).toString('utf8');
          const slug = item.taskSlug;
          // Find the task line with the link to this slug and replace waiting status nearby
          // We search up to 200 chars after the link for the status token
          const pattern = new RegExp(`(\\[[^\\]]*${slug}[^\\]]*\\]\\([^\\)]+\\).{0,200}?)(🟡\\s*\\{\\s*status\\s*:\\s*waiting\\s*\\})`, 'i');
          const replacement = `$1🔵 {status: started, started_at: ${dateStr}}`;
          const newText = sText.replace(pattern, replacement);
          if (newText !== sText) {
            await vscode.workspace.fs.writeFile(sUri, Buffer.from(newText));
          }
        }
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage('Failed to start feature from task.');
      }
    })
  );

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri;
  const extensionRoot = vscode.Uri.file(context.extensionPath);
  const sourceTemplate = vscode.Uri.joinPath(extensionRoot, "template", ".SprintDesk");
  const destTemplate = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk");

  try {
    await vscode.workspace.fs.stat(destTemplate);
    return;
  } catch {}

  try {
    await vscode.workspace.fs.copy(sourceTemplate, destTemplate, { overwrite: false });
    vscode.window.showInformationMessage("📦 SprintDesk folder has been set up in your project!");
  } catch (err) {
    console.error("Failed to copy .SprintDesk:", err);
  }
}

export function deactivate() {}
