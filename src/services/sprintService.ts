import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import insertTaskLinkUnderSection from '../utils/mdUtils';

export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string }): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const { d1, mo1, d2, mo2, yy, yyyy } = nameParts;
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
  return filePath;
}

export async function createSprintInteractive() {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter sprint as: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy',
    placeHolder: '@sprint 11-08_16-08_25'
  });
  if (!input) return;
  const m = input.match(/@sprint\s+(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{2}|\d{4})\b/i);
  if (!m) { vscode.window.showErrorMessage('Format must be: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy'); return; }
  const d1 = m[1], mo1 = m[2], d2 = m[3], mo2 = m[4];
  let yy = m[5];
  const yyyy = yy.length === 2 ? `20${yy}` : yy;
  if (yy.length === 4) yy = yy.slice(-2);
  createSprint({ d1, mo1, d2, mo2, yy, yyyy });
  vscode.window.showInformationMessage('Sprint created.');
}

export async function addExistingTasksToSprint(item: any) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  const sprintFile: string | undefined = item?.filePath;
  if (!sprintFile) { vscode.window.showErrorMessage('Sprint file not found.'); return; }

  const taskDirs = fileService.getExistingTasksDirs(ws);
  const fileEntries: { dir: string; file: string }[] = [];
  for (const d of taskDirs) {
    const entries = fileService.listMdFiles(d);
    for (const f of entries) fileEntries.push({ dir: d, file: f });
  }
  if (!fileEntries.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = fileEntries.map(({dir, file}) => {
    const titleMatch = file.match(/^\[Task\]_(.+?)(?:_\[Epic\]_.+)?\.md$/i);
    const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : file.replace(/\.md$/i, '');
    return { label: title, file, dir } as { label: string, file: string, dir: string };
  });

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
  if (!picked || picked.length === 0) return;

  try {
    let sprintContent = fs.readFileSync(sprintFile, 'utf8');
    for (const p of picked) {
      const linkTitle = p.label.trim().replace(/\s+/g, '-').toLowerCase();
      const tasksFolder = path.basename((p as any).dir || path.join(ws, '.SprintDesk', 'tasks'));
      const link = `- 📌 [${linkTitle}](../${tasksFolder}/${p.file}) ✅ [waiting]`;
      sprintContent = insertTaskLinkUnderSection(sprintContent, 'Tasks', link);
    }
    fs.writeFileSync(sprintFile, sprintContent, 'utf8');
    vscode.window.showInformationMessage('Tasks added to sprint.');
  } catch {
    vscode.window.showErrorMessage('Failed to update sprint file.');
  }
}

export async function startFeatureFromTask(item: any) {
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
    const workspaceRoot = folders[0].uri.fsPath;

    const taskSlug: string | undefined = item?.taskSlug || item?.label?.toString()?.replace(/\s+/g, '-');
    const taskFilePath: string | undefined = item?.taskFilePath;
    const sprintFilePath: string | undefined = item?.sprintFilePath;
    if (!taskSlug) { vscode.window.showErrorMessage('Unable to infer task name.'); return; }

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
      let sprintText = Buffer.from(sBytes).toString('utf8');
      const linkTitle = item.taskSlug.replace(/\s+/g, '-').toLowerCase();
      const link = `- 📌 [${linkTitle}](../tasks/${item?.taskFileName || item?.taskFilePath?.split('\\').pop()}) ✅ [in progress]`;
      sprintText = insertTaskLinkUnderSection(sprintText, 'Tasks', link);
      await vscode.workspace.fs.writeFile(sUri, new TextEncoder().encode(sprintText));
    }
  } catch (e) {
    vscode.window.showErrorMessage('Failed to start feature from task.');
  }
}
