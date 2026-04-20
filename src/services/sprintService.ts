import * as vscode from 'vscode';
import * as path from 'path';
import * as fileService from './fileService';
import { getDataService } from '../data/DataService';
import * as taskService from './taskService';
import { PROJECT_CONSTANTS, SPRINT_CONSTANTS } from '../utils/constant';
import { Sprint } from '../data/types';

export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string }): string {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');
  
  const { d1, mo1, d2, mo2, yy, yyyy } = nameParts;
  const shortStart = `${d1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;
  const shortEnd = `${d2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;

  const dataService = getDataService(ws);
  const sprintId = dataService.generateId('sprint');
  const sprint: Sprint = {
    id: sprintId,
    name: `Sprint : ${shortStart} ➜ ${shortEnd}`,
    startDate: `${d1}${mo1}${yyyy}`,
    endDate: `${d2}${mo2}${yyyy}`,
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
  const yyyy = yy.length === 2 ? `${SPRINT_CONSTANTS.SEPARATOR.YEAR_PREFIX}${yy}` : yy;
  if (yy.length === 4) yy = yy.slice(-2);
  
  createSprint({ d1, mo1, d2, mo2, yy, yyyy });
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

export function getTasksFromSprint(sprintId: string): { label: string; path: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => sprint.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t))
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