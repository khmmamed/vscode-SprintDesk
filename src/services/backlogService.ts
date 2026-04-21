import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { getDataService } from '../data/DataService';
import * as taskService from './taskService';
import { Backlog } from '../data/types';

export async function createBacklogInteractive(): Promise<void> {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const backlogTitle = await vscode.window.showInputBox({
    prompt: 'Enter backlog title',
    placeHolder: 'e.g., FEATURES, BUGS, TECHNICAL'
  });

  if (!backlogTitle) return;

  const titleUpper = backlogTitle.toUpperCase().trim();
  const backlogId = titleUpper.toLowerCase().replace(/\s+/g, '-');
  const dataService = getDataService(ws);

  if (dataService.getBacklog(backlogId)) {
    vscode.window.showWarningMessage(`Backlog "${titleUpper}" already exists.`);
    return;
  }

  const backlog: Backlog = {
    id: backlogId,
    title: titleUpper,
    name: `[Backlog]_${titleUpper}`,
    description: '',
    tasks: [],
    color: '#2563eb'
  };

  backlog.path = path.join(dataService.getBacklogsDir(), `${backlog.name}.md`);

  dataService.addBacklog(backlog);
  dataService.saveBacklogMd(backlog);

  vscode.window.showInformationMessage(`Backlog "${titleUpper}" created.`);
}

export function getBacklogs(ws: string): Backlog[] {
  const dataService = getDataService(ws);
  return dataService.loadBacklogs();
}

export function getBacklog(backlogId: string): Backlog | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getBacklog(backlogId);
}

export function updateBacklog(backlogId: string, updates: Partial<Backlog>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateBacklog(backlogId, updates);
  const updated = dataService.getBacklog(backlogId);
  if (updated) dataService.saveBacklogMd(updated);
}

export function deleteBacklog(backlogId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteBacklog(backlogId);
}

export async function addExistingTasksToBacklog(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  
  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found.'); return; }

  const tasks = taskService.loadTasks();
  if (!tasks.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = tasks.map(t => ({
    label: t.title,
    taskId: t.id,
    task: t
  }));

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Backlog' });
  if (!picked || picked.length === 0) return;

  try {
    const dataService = getDataService(ws);
    const backlogId = path.basename(backlogFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const backlog = dataService.getBacklog(backlogId);
    if (!backlog) { vscode.window.showErrorMessage('Backlog not found in data store.'); return; }

    for (const p of picked) {
      const taskObj = (p as any).task;
      if (!taskObj) continue;

      if (!backlog.tasks.includes(taskObj.id)) {
        backlog.tasks.push(taskObj.id);
      }

      dataService.updateTask(taskObj.id, { backlog: backlogId });
      dataService.saveTaskMd(taskObj);
    }

    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);

    vscode.window.showInformationMessage('Tasks added to backlog.');
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage('Failed to update backlog.');
  }
}

export function addTaskToBacklog(backlogPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlogName = path.basename(backlogPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const backlogs = dataService.loadBacklogs();
  const backlog = backlogs.find(b => b.id === backlogName);
  if (!backlog) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  if (!backlog.tasks.includes(task.id)) {
    backlog.tasks.push(task.id);
    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);
  }
  
  dataService.updateTask(task.id, { backlog: backlog.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromBacklog(backlogPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlogName = path.basename(backlogPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const backlogs = dataService.loadBacklogs();
  const backlog = backlogs.find(b => b.id === backlogName);
  if (!backlog) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  backlog.tasks = backlog.tasks.filter(t => t !== task.id);
  dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
  dataService.saveBacklogMd(backlog);
  
  dataService.updateTask(task.id, { backlog: '' });
  dataService.saveTaskMd(task);
}

export function addTaskToBacklogById(backlogId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  if (!backlog.tasks.includes(task.id)) {
    backlog.tasks.push(task.id);
    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);
  }
  
  dataService.updateTask(task.id, { backlog: backlog.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromBacklogById(backlogId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  backlog.tasks = backlog.tasks.filter(t => t !== task.id);
  dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
  dataService.saveBacklogMd(backlog);
  
  dataService.updateTask(task.id, { backlog: '' });
  dataService.saveTaskMd(task);
}

export function getTasksFromBacklog(backlogId: string): any[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog || !backlog.tasks) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => backlog.tasks.includes(t.id)).map(t => {
    const taskPath = path.join(tasksDir, dataService.getTaskFilename(t));
    return {
      label: t.title,
      path: taskPath,
      id: t.id,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      command: {
        command: 'vscode.open',
        title: 'Open Task',
        arguments: [vscode.Uri.file(taskPath)]
      }
    };
  });
}

export function getTasksFromBacklogById(backlogId: string): any[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog || !backlog.tasks) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => backlog.tasks.includes(t.id)).map(t => {
    const taskPath = path.join(tasksDir, dataService.getTaskFilename(t));
    return {
      label: t.title,
      path: taskPath,
      id: t.id,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      command: {
        command: 'vscode.open',
        title: 'Open Task',
        arguments: [vscode.Uri.file(taskPath)]
      }
    };
  });
}

export function listBacklogs(ws: string): { id: string; filePath: string; title: string; tasks: { label: string; abs?: string }[] }[] {
  const dataService = getDataService(ws);
  const backlogs = dataService.loadBacklogs();
  const tasks = dataService.loadTasks();
  
  return backlogs.map(backlog => ({
    id: backlog.id,
    filePath: path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR, `${backlog.id}.md`),
    title: backlog.name,
    tasks: tasks.filter(t => backlog.tasks.includes(t.id)).map(t => ({
      label: t.title,
      abs: path.join(dataService.getTasksDir(), dataService.getTaskFilename(t))
    }))
  }));
}

export function listBacklogsSummary(ws: string): { filePath: string; title: string; tasks: { label: string; abs?: string }[] }[] {
  return listBacklogs(ws);
}

export function readBacklog(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function updateBacklogContent(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteBacklogFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export async function addTaskToBacklogInteractive(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  
  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found for this item.'); return; }
  
  const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
  if (!taskName) return;
  
  try {
    const createdTask = await taskService.createTask(ws, {
      title: taskName,
      type: 'feature',
      status: 'waiting',
      priority: 'medium'
    });

    const dataService = getDataService(ws);
    const backlogId = path.basename(backlogFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const backlog = dataService.getBacklog(backlogId);
    if (!backlog) { vscode.window.showErrorMessage('Backlog not found.'); return; }

    if (!backlog.tasks.includes(createdTask.id)) {
      backlog.tasks.push(createdTask.id);
    }

    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);

    dataService.updateTask(createdTask.id, { backlog: backlogId });
    dataService.saveTaskMd(createdTask);

    vscode.window.showInformationMessage('Task added to backlog.');
  } catch (e) {
    console.error(e);
    vscode.window.showErrorMessage('Failed to add task to backlog.');
  }
}