import * as vscode from 'vscode';
import * as path from 'path';
import { getDataService } from '../data/DataService';
import * as fileService from './fileService';
import { Task } from '../data/types';

class TaskService {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || this.getDefaultWorkspaceRoot();
  }

  private getDefaultWorkspaceRoot(): string {
    const ws = vscode.workspace.workspaceFolders;
    return ws?.[0]?.uri.fsPath || '';
  }

  setWorkspaceRoot(ws: string): void {
    this.workspaceRoot = ws;
  }

  loadTasks(): Task[] {
    const dataService = getDataService(this.workspaceRoot);
    return dataService.loadTasks();
  }

  getTask(taskId: string): Task | undefined {
    const dataService = getDataService(this.workspaceRoot);
    return dataService.getTask(taskId);
  }

  createTask(taskData: {
    title: string;
    type?: string;
    status?: string;
    priority?: string;
    backlog?: string;
    epic?: string | null;
  }): Task {
    const dataService = getDataService(this.workspaceRoot);
    const config = dataService.loadConfig();

    const task: Task = {
      id: dataService.generateId('task'),
      code: dataService.generateId('task'),
      title: taskData.title,
      type: (taskData.type as Task['type']) || (config.defaults.type as Task['type']) || 'feature',
      status: (taskData.status as Task['status']) || (config.defaults.status as Task['status']) || 'waiting',
      priority: (taskData.priority as Task['priority']) || (config.defaults.priority as Task['priority']) || 'medium',
      epic: taskData.epic || null,
      backlog: taskData.backlog || config.defaults.backlog || 'features',
      sprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    dataService.addTask(task);
    dataService.saveTaskMd(task);

    return task;
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const dataService = getDataService(this.workspaceRoot);
    dataService.updateTask(taskId, updates);
    const updated = dataService.getTask(taskId);
    if (updated) dataService.saveTaskMd(updated);
  }

  deleteTask(taskId: string): void {
    const dataService = getDataService(this.workspaceRoot);
    dataService.deleteTask(taskId);
    dataService.deleteTaskMd(taskId);
  }

  createTaskFromData(taskData: Task): Task {
    const dataService = getDataService(this.workspaceRoot);
    const task: Task = { ...taskData };
    task.createdAt = task.createdAt || new Date().toISOString();
    task.updatedAt = task.updatedAt || new Date().toISOString();

    dataService.addTask(task);
    dataService.saveTaskMd(task, true);

    return task;
  }
}

let taskServiceInstance: TaskService | null = null;

export function getTaskService(workspaceRoot?: string): TaskService {
  if (!taskServiceInstance) {
    taskServiceInstance = new TaskService(workspaceRoot);
  } else if (workspaceRoot) {
    taskServiceInstance = new TaskService(workspaceRoot);
  }
  return taskServiceInstance;
}

export function loadTasks(): Task[] {
  return getTaskService().loadTasks();
}

export function getTask(taskId: string): Task | undefined {
  return getTaskService().getTask(taskId);
}

export async function createTask(ws: string, taskData: {
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  backlog?: string;
  epic?: string | null;
}): Promise<Task> {
  return getTaskService(ws).createTask(taskData);
}

export function updateTask(taskId: string, updates: Partial<Task>): void {
  getTaskService().updateTask(taskId, updates);
}

export function createTaskFromData(ws: string, taskData: Task): Task {
  return getTaskService(ws).createTaskFromData(taskData);
}

export function deleteTask(taskId: string): void {
  getTaskService().deleteTask(taskId);
}

export function readTasks(ws: string): string[] {
  const dataService = getDataService(ws);
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.map(t => {
    const filename = dataService.getTaskFilename(t);
    return require('path').join(tasksDir, filename);
  });
}

export function updateTaskByPath(taskPath: string, updates: Partial<Task>): void {
  let ws: string;
  try {
    ws = fileService.getWorkspaceRoot();
  } catch {
    ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const tasks = dataService.loadTasks();
  
  const task = tasks.find(t => {
    const filename = dataService.getTaskFilename(t);
    return path.join(dataService.getTasksDir(), filename) === taskPath;
  });
  
  if (task) {
    dataService.updateTask(task.id, updates);
    const updated = dataService.getTask(task.id);
    if (updated) dataService.saveTaskMd(updated);
  }
}