import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as fileService from './fileService';
import insertTaskLinkUnderSection from '../utils/mdUtils';

export function listEpics(ws: string): string[] {
  const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
  return fileService.listMdFiles(epicsDir).map(f => path.join(epicsDir, f));
}

export function readEpic(filePath: string): string {
  return fileService.readFileSyncSafe(filePath);
}

export function createEpic(name: string): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
  fs.mkdirSync(epicsDir, { recursive: true });
  const epicFile = path.join(epicsDir, `[Epic]_${name.replace(/\s+/g, '-')}.md`);
  if (!fs.existsSync(epicFile)) {
    fs.writeFileSync(epicFile, `# Epic: ${name}\n\n## Tasks\n`, 'utf8');
  }
  return epicFile;
}

export function updateEpic(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteEpic(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function addTaskToEpic(epicName: string, taskFileName: string) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const epicsDir = path.join(ws, '.SprintDesk', 'Epics');
  const epicFile = path.join(epicsDir, `[Epic]_${epicName.replace(/\s+/g, '-')}.md`);
  let epicContent = fileService.readFileSyncSafe(epicFile) || `# Epic: ${epicName}\n`;
  const taskLink = `- 📌 [${taskFileName.replace(/\.md$/i, '').replace(/\[Task\]_/, '').replace(/_/g, '-').toLowerCase()}](../tasks/${taskFileName})`;
  epicContent = insertTaskLinkUnderSection(epicContent, 'tasks', taskLink);
  fs.writeFileSync(epicFile, epicContent, 'utf8');
}

export async function createEpicInteractive() {
  const epicName = await (vscode.window.showInputBox as any)({ prompt: 'Epic title' });
  if (!epicName) return;
  createEpic(epicName);
  vscode.window.showInformationMessage('Epic created.');
}
