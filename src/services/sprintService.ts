import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { getDataService } from '../data/DataService';
import * as taskService from './taskService';
import insertTaskLinkUnderSection from '../utils/mdUtils';
import { PROJECT_CONSTANTS, SPRINT_CONSTANTS, UI_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import { getSprintTasks } from '../controller/sprintController';
import { relativePathTaskToTaskpath } from '../utils/taskUtils';
import { SprintDeskItem } from '../utils/SprintDeskItem';
interface TreeItemLike {
  label: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  // absolute path if file exists
  path?: string;
  // relative path as listed in backlog frontmatter or link
  rel?: string;
  command?: {
    command: string;
    title: string;
    arguments: any[];
  };
}
export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string }): string {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const { d1, mo1, d2, mo2, yy, yyyy } = nameParts;
  const shortStart = `${d1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;
  const shortEnd = `${d2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;

  const dataService = getDataService(ws);
  const sprintId = dataService.generateId('sprint');
  const sprint: any = {
    id: sprintId,
    name: `Sprint : ${shortStart} ➜ ${shortEnd}`,
    startDate: `${d1}${mo1}${yyyy}`,
    endDate: `${d2}${mo2}${yyyy}`,
    status: 'planned',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  dataService.addSprint(sprint);
  dataService.saveSprintMd(sprint);

  return path.join(fileService.getSprintsDir(ws), `${sprint.id}.md`);
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
  const yyyy = yy.length === 2 ? `${SPRINT_CONSTANTS.SEPARATOR.YEAR_PREFIX}${yy}` : yy;
  if (yy.length === 4) yy = yy.slice(-2);
  createSprint({ d1, mo1, d2, mo2, yy, yyyy });
  vscode.window.showInformationMessage('Sprint created.');
}

export async function addExistingTasksToSprint(item: any) {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
  const titleMatch = file.match(new RegExp(`^${PROJECT_CONSTANTS.FILE_PREFIX.TASK}(.+?)(?:_${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}.+)?${PROJECT_CONSTANTS.MD_FILE_EXTENSION}$`, 'i'));
  const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : file.replace(new RegExp(`${PROJECT_CONSTANTS.MD_FILE_EXTENSION}$`, 'i'), '');
    return { label: title, file, dir } as { label: string, file: string, dir: string };
  });

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
  if (!picked || picked.length === 0) return;

  try {
    const dataService = getDataService(ws);
    const sprintId = path.basename(sprintFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const sprint = dataService.getSprint(sprintId);
    if (!sprint) { vscode.window.showErrorMessage('Sprint not found in data store.'); return; }

    const allTasks = dataService.loadTasks();

    for (const p of picked) {
      const abs = path.join(p.dir, p.file);
      const fileText = fileService.readFileSyncSafe(abs);
      const tm = require('gray-matter')(fileText);
      const taskId = tm.data._id || tm.data.id || path.basename(p.file, PROJECT_CONSTANTS.MD_FILE_EXTENSION);

      // ensure task exists in YAML; if not create via taskService
      let taskObj = dataService.getTask(taskId);
      if (!taskObj) {
        try {
          const created = await taskService.createTask(ws, { title: tm.data.title || path.basename(p.file, PROJECT_CONSTANTS.MD_FILE_EXTENSION) });
          taskObj = created as any;
        } catch {
          continue;
        }
      }

      if (!taskObj) continue; // narrow type for TypeScript

      if (!sprint.tasks.includes(taskObj.id)) sprint.tasks.push(taskObj.id);

      dataService.updateTask(taskObj.id, { sprint: sprint.id });
      dataService.saveTaskMd(taskObj as any);
    }

    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);

    vscode.window.showInformationMessage('Tasks added to sprint.');
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage('Failed to update sprint.');
  }
}

export async function startFeatureFromTask(item: any) {
  try {
    const workspaceRoot = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

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
      // update YAML source of truth
      try {
        const dataService = getDataService(workspaceRoot);
        const tm = require('gray-matter')(updated);
        const taskId = tm.data._id || tm.data.id || undefined;
        if (taskId) {
          dataService.updateTask(taskId, { status: 'in-progress' });
          const taskObj = dataService.getTask(taskId);
          if (taskObj) dataService.saveTaskMd(taskObj);
        }
      } catch (e) { console.error('Failed to sync task status to YAML', e); }
    }

    if (sprintFilePath && item?.taskSlug) {
      try {
        const dataService = getDataService(workspaceRoot);
        const sprintId = path.basename(sprintFilePath, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
        const sprint = dataService.getSprint(sprintId);
        if (sprint && item?.taskFileName) {
          const taskId = item.taskSlug || path.basename(item.taskFileName, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
          if (!sprint.tasks.includes(taskId)) sprint.tasks.push(taskId);
          dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
          dataService.saveSprintMd(sprint);
        }
      } catch (e) { console.error('Failed to sync sprint from task start', e); }
    }
  } catch (e) {
    vscode.window.showErrorMessage('Failed to start feature from task.');
  }
}

export function getTasksFromSprint(sprintName: string): TreeItemLike[] {
  try {
    const tasks = getSprintTasks(sprintName);
    return tasks.map((t: any) => {
      const label = path.basename(t.path || '');
      const absPath = t.path;
      return { 
        label, 
        absPath, 
        collapsibleState: vscode.TreeItemCollapsibleState.None, 
        path: relativePathTaskToTaskpath(t.path) 
      };
    });
  } catch (e) {
     throw new Error('No tasks found.');
  }
}
