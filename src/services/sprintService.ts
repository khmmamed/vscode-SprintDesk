import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fileService from './fileService';
import { getDataService } from '../data/DataService';
import * as taskService from './taskService';
import { PROJECT_CONSTANTS, SPRINT_CONSTANTS } from '../utils/constant';
import { Sprint } from '../data/types';

export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string; title?: string }): string {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  const { d1, mo1, d2, mo2, yy, yyyy, title } = nameParts;

  const dataService = getDataService(ws);
  const sprintNumber = dataService.generateNextNumber('sprint');
  const config = dataService.loadConfig();
  const sprintPrefix = config.ids.sprint.prefix;

  const sprintTitle = title || `${d1}-${mo1}-${yy} ➜ ${d2}-${mo2}-${yy}`;
  const sprintName = `[${sprintPrefix}-${sprintNumber}]_${sprintTitle}`;

  const sprint: Sprint = {
    id: crypto.randomUUID(),
    number: sprintNumber,
    title: sprintTitle,
    name: sprintName,
    startDate: `${d1}-${mo1}-${yyyy}`,
    endDate: `${d2}-${mo2}-${yyyy}`,
    status: 'planned',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  sprint.path = path.join(dataService.getSprintsDir(), dataService.getSprintFilename(sprint));

  dataService.addSprint(sprint);
  dataService.saveSprintMd(sprint);

  return sprint.path;
}

export async function createSprintInteractive() {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter: @from DD-MM @to DD-MM @year YYYY @title Title',
    placeHolder: '@from 23-04 @to 30-04 @year 2026 @title Starting'
  });
  if (!input) return;

  const fromMatch = input.match(/@from\s+(\d{2})-(\d{2})/i);
  const toMatch = input.match(/@to\s+(\d{2})-(\d{2})/i);
  const yearMatch = input.match(/@year\s+(\d{4})/i);
  const titleMatch = input.match(/@title\s+(.+)/i);

  if (!fromMatch || !toMatch) {
    vscode.window.showErrorMessage('Format: @from DD-MM @to DD-MM @year YYYY @title Title');
    return;
  }

  const d1 = fromMatch[1], mo1 = fromMatch[2];
  const d2 = toMatch[1], mo2 = toMatch[2];
  const yy = new Date().getFullYear().toString().slice(-2);
  const yyyy = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  const title = titleMatch ? titleMatch[1].trim() : undefined;
  createSprint({ d1, mo1, d2, mo2, yy, yyyy, title });
  vscode.window.showInformationMessage('Sprint created.');
}

export async function addExistingTasksToSprint(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  
  const sprintFile: string | undefined = item?.filePath;
  if (!sprintFile) { vscode.window.showErrorMessage('Sprint file not found.'); return; }

  const tasks = taskService.loadTasks();
  if (!tasks.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = tasks.map(t => ({
    label: t.title,
    taskId: t.id,
    task: t
  }));

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
  if (!picked || picked.length === 0) return;

  try {
    const dataService = getDataService(ws);
    const sprintId = path.basename(sprintFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const sprint = dataService.getSprint(sprintId);
    if (!sprint) { vscode.window.showErrorMessage('Sprint not found in data store.'); return; }

    for (const p of picked) {
      const taskObj = (p as any).task;
      if (!taskObj) continue;

      if (!sprint.tasks.includes(taskObj.id)) {
        sprint.tasks.push(taskObj.id);
      }

      dataService.updateTask(taskObj.id, { sprint: sprint.id });
      dataService.saveTaskMd(taskObj);
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
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const taskSlug: string | undefined = item?.taskSlug || item?.label?.toString()?.replace(/\s+/g, '-');
    const taskFilePath: string | undefined = item?.taskFilePath;
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
        updated = text.replace(statusRegex, (_m: any, head: string, tail: string) => `${head}\n- **🟢 Started:** ${dateStr}\n${tail}`);
      } else {
        updated = `${text}\n\n- **🟢 Started:** ${dateStr}\n`;
      }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));

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

    if (taskFilePath && item?.taskSlug) {
      try {
        const dataService = getDataService(workspaceRoot);
        const sprintId = path.basename(taskFilePath, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
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

export function getSprints(ws: string): Sprint[] {
  const dataService = getDataService(ws);
  return dataService.loadSprints();
}

export function getSprint(sprintId: string): Sprint | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getSprint(sprintId);
}

export function updateSprint(sprintId: string, updates: Partial<Sprint>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateSprint(sprintId, updates);
  const updated = dataService.getSprint(sprintId);
  if (updated) dataService.saveSprintMd(updated);
}

export function deleteSprint(sprintId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteSprint(sprintId);
}

export function getTasksFromSprint(sprintId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint || !sprint.tasks) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => sprint.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function getTasksFromSprintById(sprintId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint || !sprint.tasks) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => sprint.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function getSprintPath(sprintName: string): string {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.name.includes(sprintName) || s.id === sprintName);
  if (!sprint) return '';
  
  return path.join(fileService.getSprintsDir(ws), `${sprint.id}.md`);
}

export function addTaskToSprint(sprintPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const sprintName = path.basename(sprintPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.id === sprintName || s.name.includes(sprintName));
  if (!sprint) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  if (!sprint.tasks.includes(task.id)) {
    sprint.tasks.push(task.id);
    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);
  }
  
  dataService.updateTask(task.id, { sprint: sprint.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromSprint(sprintPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const sprintName = path.basename(sprintPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.id === sprintName || s.name.includes(sprintName));
  if (!sprint) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  sprint.tasks = sprint.tasks.filter(t => t !== task.id);
  dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
  dataService.saveSprintMd(sprint);
  
  dataService.updateTask(task.id, { sprint: null });
  dataService.saveTaskMd(task);
}

export function addTaskToSprintById(sprintId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  if (!sprint.tasks) {
    sprint.tasks = [];
  }
  
  if (!sprint.tasks.includes(task.id)) {
    sprint.tasks.push(task.id);
    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);
  }
  
  dataService.updateTask(task.id, { sprint: sprint.name });
  dataService.saveTaskMd(task);
}

export function removeTaskFromSprintById(sprintId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  sprint.tasks = sprint.tasks.filter(t => t !== task.id);
  dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
  dataService.saveSprintMd(sprint);
  
  dataService.updateTask(task.id, { sprint: null });
  dataService.saveTaskMd(task);
}