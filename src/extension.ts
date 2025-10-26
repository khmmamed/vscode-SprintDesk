import * as vscode from "vscode";
import { registerOpenWebviewCommand } from "./commands/openWebview";
import { registerViewTasksCommand } from "./commands/viewTasks";
import { registerViewBacklogsCommand } from "./commands/viewBacklogs";
import { addMultipleTasksCommand } from "./commands/addMultipleTasksCommand";
import { registerViewEpicsCommand } from "./commands/viewEpics";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerAddQuicklyCommand } from "./commands/addQuicklyCommand";
import { getWebviewContent } from "./webview/getWebviewContent";
import { SprintsTreeDataProvider } from './sidebar/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './sidebar/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './sidebar/BacklogsTreeDataProvider';
import * as path from 'path';
import * as fs from 'fs';

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
  // Register existing commands
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerViewEpicsCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);

  // Add Sprint: view title button on Sprints
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addSprint', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    const input = await vscode.window.showInputBox({
      prompt: 'Enter sprint as: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy',
      placeHolder: '@sprint 11-08_16-08_25'
    });
    if (!input) return;

    const m = input.match(/@sprint\s+(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{2}|\d{4})\b/i);
    if (!m) {
      vscode.window.showErrorMessage('Format must be: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy');
      return;
    }
    const d1 = m[1], mo1 = m[2], d2 = m[3], mo2 = m[4];
    let yy = m[5];
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    if (yy.length === 4) {
      yy = yy.slice(-2);
    }

    const fileName = `[Sprint]_${d1}-${mo1}_${d2}-${mo2}_${yyyy}.md`;
    const sprintsDir = path.join(ws, '.SprintDesk', 'Sprints');
    fs.mkdirSync(sprintsDir, { recursive: true });
    const filePath = path.join(sprintsDir, fileName);

    if (!fs.existsSync(filePath)) {
      const shortStart = `${d1}-${mo1}-${yy}`;
      const shortEnd = `${d2}-${mo2}-${yy}`;
      const content = `# 📅 Sprint : ${shortStart} ➜ ${shortEnd}\n- **🗓 Last update:** ${new Date().toISOString()}\n- **🛠 Total Tasks:** 0\n- **📊 Progress:** ✅ [0/0] 🟩100%\n- **📝 Summary:** \n\n## 📋 Tasks\n`;
      fs.writeFileSync(filePath, content, 'utf8');
    }
    vscode.window.showInformationMessage('Sprint created.');
  }));

  // Add Task: view title button on Tasks
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTask', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
    if (!taskName) return;
    const epicName = await vscode.window.showInputBox({ prompt: 'Epic name (optional)' });

    const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
    const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(epicsDir, { recursive: true });

    let fileName = `[Task]_${taskName.replace(/\s+/g, '-')}`;
    if (epicName) fileName += `_[Epic]_${epicName.replace(/\s+/g, '-')}`;
    fileName += '.md';

    const taskPath = path.join(tasksDir, fileName);
    if (!fs.existsSync(taskPath)) {
      fs.writeFileSync(taskPath, `# Task: ${taskName}\n${epicName ? `Epic: ${epicName}\n` : ''}`, 'utf8');
    }

    if (epicName) {
      const epicFile = path.join(epicsDir, `[Epic]_${epicName.replace(/\s+/g, '-')}.md`);
      let epicContent = fs.existsSync(epicFile) ? fs.readFileSync(epicFile, 'utf8') : `# Epic: ${epicName}\n`;
      const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${fileName})`;
      epicContent = insertTaskLinkUnderSection(epicContent, 'tasks', taskLink);
      fs.writeFileSync(epicFile, epicContent, 'utf8');
    }

    vscode.window.showInformationMessage('Task created.');
  }));

  // Add Epic: view title button on Epics
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addEpic', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const epicName = await vscode.window.showInputBox({ prompt: 'Epic title' });
    if (!epicName) return;

    const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
    fs.mkdirSync(epicsDir, { recursive: true });
    const epicPath = path.join(epicsDir, `[Epic]_${epicName.replace(/\s+/g, '-')}.md`);
    if (!fs.existsSync(epicPath)) {
      fs.writeFileSync(epicPath, `# Epic: ${epicName}\n\n## Tasks\n`, 'utf8');
    }

    vscode.window.showInformationMessage('Epic created.');
  }));

  // Add existing tasks to Sprint: inline on sprint item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToSprint', async (item: any) => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
    const sprintFile: string | undefined = item?.filePath;
    if (!sprintFile) { vscode.window.showErrorMessage('Sprint file not found.'); return; }

    // Collect existing tasks from .SprintDesk/tasks
    const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
    if (!fs.existsSync(tasksDir)) { vscode.window.showErrorMessage('No tasks directory found.'); return; }
    const files = fs.readdirSync(tasksDir).filter(f => f.toLowerCase().endsWith('.md'));
    if (!files.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

    const itemsQP = files.map(f => {
      const titleMatch = f.match(/^\[Task\]_(.+?)(?:_\[Epic\]_.+)?\.md$/);
      const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : f.replace(/\.md$/, '');
      return { label: title, file: f } as { label: string, file: string };
    });

    const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
    if (!picked || picked.length === 0) return;

    try {
      let sprintContent = fs.readFileSync(sprintFile, 'utf8');
      for (const p of picked) {
        const linkTitle = p.label.trim().replace(/\s+/g, '-').toLowerCase();
        const link = `- 📌 [${linkTitle}](../tasks/${p.file}) ✅ [waiting]`;
        sprintContent = insertTaskLinkUnderSection(sprintContent, 'Tasks', link);
      }
      fs.writeFileSync(sprintFile, sprintContent, 'utf8');
      vscode.window.showInformationMessage('Tasks added to sprint.');
    } catch {
      vscode.window.showErrorMessage('Failed to update sprint file.');
    }
  }));

  // Add Task to Backlog: inline button on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTaskToBacklog', async (item: any) => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const backlogFile: string | undefined = item?.filePath;
    if (!backlogFile) {
      vscode.window.showErrorMessage('Backlog file not found for this item.');
      return;
    }
    const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
    if (!taskName) return;
    const epicName = await vscode.window.showInputBox({ prompt: 'Epic name (optional)' });

    const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
    const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(epicsDir, { recursive: true });

    let fileName = `[Task]_${taskName.replace(/\s+/g, '-')}`;
    if (epicName) fileName += `_[Epic]_${epicName.replace(/\s+/g, '-')}`;
    fileName += '.md';

    const taskPath = path.join(tasksDir, fileName);
    if (!fs.existsSync(taskPath)) {
      fs.writeFileSync(taskPath, `# Task: ${taskName}\n${epicName ? `Epic: ${epicName}\n` : ''}`, 'utf8');
    }

    if (epicName) {
      const epicFile = path.join(epicsDir, `[Epic]_${epicName.replace(/\s+/g, '-')}.md`);
      let epicContent = fs.existsSync(epicFile) ? fs.readFileSync(epicFile, 'utf8') : `# Epic: ${epicName}\n`;
      const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${fileName})`;
      epicContent = insertTaskLinkUnderSection(epicContent, 'tasks', taskLink);
      fs.writeFileSync(epicFile, epicContent, 'utf8');
    }

    try {
      let backlogContent = fs.readFileSync(backlogFile, 'utf8');
      const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${fileName})`;
      backlogContent = insertTaskLinkUnderSection(backlogContent, 'Tasks', taskLink);
      fs.writeFileSync(backlogFile, backlogContent, 'utf8');
      vscode.window.showInformationMessage('Task added to backlog.');
    } catch (e) {
      vscode.window.showErrorMessage('Failed to update backlog file.');
    }
  }));

  // Add existing tasks to Backlog: inline on backlog item
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToBacklog', async (item: any) => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
    const backlogFile: string | undefined = item?.filePath;
    if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found.'); return; }

    const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
    if (!fs.existsSync(tasksDir)) { vscode.window.showErrorMessage('No tasks directory found.'); return; }
    const files = fs.readdirSync(tasksDir).filter(f => f.toLowerCase().endsWith('.md'));
    if (!files.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

    const itemsQP = files.map(f => {
      const titleMatch = f.match(/^\[Task\]_(.+?)(?:_\[Epic\]_.+)?\.md$/);
      const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : f.replace(/\.md$/, '');
      return { label: title, file: f } as { label: string, file: string };
    });

    const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Backlog' });
    if (!picked || picked.length === 0) return;

    try {
      let content = fs.readFileSync(backlogFile, 'utf8');
      for (const p of picked) {
        const linkTitle = p.label.trim().replace(/\s+/g, '-').toLowerCase();
        const link = `- 📌 [${linkTitle}](../tasks/${p.file}) ✅ [waiting]`;
        content = insertTaskLinkUnderSection(content, 'Tasks', link);
      }
      fs.writeFileSync(backlogFile, content, 'utf8');
      vscode.window.showInformationMessage('Tasks added to backlog.');
    } catch {
      vscode.window.showErrorMessage('Failed to update backlog file.');
    }
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
          await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
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
            await vscode.workspace.fs.writeFile(sUri, new TextEncoder().encode(newText));
          }
        }
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage('Failed to start feature from task.');
      }
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