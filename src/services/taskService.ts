import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import * as epicService from './epicService';

function generateTaskTemplate(title: string) {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  const generatedId = `tsk_${slug}`;
  return `---\n_id: ${generatedId}\nname: ${slug}\n---\n\n# 🧩 Task: ${title}\n`;
}

export function listTasks(ws: string): string[] {
  const tasksDirs = fileService.getExistingTasksDirs(ws);
  const files: string[] = [];
  for (const d of tasksDirs) {
    const entries = fileService.listMdFiles(d);
    files.push(...entries.map(f => path.join(d, f)));
  }
  return files;
}

export function readTask(filePath: string): string {
  return fileService.readFileSyncSafe(filePath);
}

export function createTask(title: string, epicName?: string): { filePath: string; fileName: string } {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  let fileName = `[Task]_${title.replace(/\s+/g, '-')}`;
  if (epicName) fileName += `_[Epic]_${epicName.replace(/\s+/g, '-')}`;
  fileName += '.md';
  const taskPath = path.join(tasksDir, fileName);
  if (!fs.existsSync(taskPath)) {
    const content = generateTaskTemplate(title);
    fs.writeFileSync(taskPath, content, 'utf8');
  }
  return { filePath: taskPath, fileName };
}

export function updateTask(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteTask(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export async function createTaskInteractive() {
  const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
  if (!taskName) return;
  const epicName = await vscode.window.showInputBox({ prompt: 'Epic name (optional)' });
  try {
    createTask(taskName, epicName || undefined);
    if (epicName) {
      // ensure epic file gets linked by EpicService
      const fileName = `[Task]_${taskName.replace(/\s+/g, '-')}${epicName ? `_[Epic]_${epicName.replace(/\s+/g, '-')}` : ''}.md`;
      await (epicService.addTaskToEpic as any)(epicName, fileName);
    }
    vscode.window.showInformationMessage('Task created.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to create task.');
  }
}
