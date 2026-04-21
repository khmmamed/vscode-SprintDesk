import * as path from 'path';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { getDataService } from '../data/DataService';
import { Epic } from '../data/types';

export async function createNewEpic(epicMetadata: SprintDesk.EpicMetadata): Promise<SprintDesk.EpicMetadata> {
  const ws = fileService.getWorkspaceRoot();
  const title = epicMetadata.title || await vscode.window.showInputBox({ prompt: 'Epic Title' });
  if (!title) throw new Error('Epic title is required');

  const category = epicMetadata.category || await vscode.window.showInputBox({ prompt: 'Epic Category (e.g., SEO, FE, BE)', placeHolder: 'MISC' }) || 'MISC';

  const dataService = getDataService(ws);
  const epicId = crypto.randomUUID();
  const epicNumber = dataService.generateNextNumber('epic');
  const epicCode = dataService.generateCode('epic', epicNumber);

  const epic: Epic = {
    id: epicId,
    number: epicNumber,
    code: epicCode,
    name: '',
    title: title,
    category: category,
    description: epicMetadata.description || '',
    status: 'planned',
    priority: 'medium',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  epic.name = `[${epicCode}]_${category}_${dataService.slugifyTitle(title)}`;
  epic.path = path.join(dataService.getEpicsDir(), dataService.getEpicFilename(epic));

  dataService.addEpic(epic);
  dataService.saveEpicMd(epic);

  return {
    _id: epic.id as any,
    title: epic.title,
    status: epic.status as SprintDesk.EpicStatus,
    priority: epic.priority as SprintDesk.Priority,
    createdAt: epic.createdAt,
    updatedAt: epic.updatedAt,
    totalTasks: 0,
    completedTasks: 0,
    path: epic.path
  };
}

export function createEpic(name: string, category?: string): string {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  const dataService = getDataService(ws);
  const epicId = crypto.randomUUID();
  const epicNumber = dataService.generateNextNumber('epic');
  const epicCode = dataService.generateCode('epic', epicNumber);
  const epicCategory = category || 'MISC';

  const epic: Epic = {
    id: epicId,
    number: epicNumber,
    code: epicCode,
    name: '',
    title: name,
    category: epicCategory,
    description: '',
    status: 'planned',
    priority: 'medium',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  epic.name = `[${epicCode}]_${epicCategory}_${dataService.slugifyTitle(name)}`;
  epic.path = path.join(dataService.getEpicsDir(), dataService.getEpicFilename(epic));

  dataService.addEpic(epic);
  dataService.saveEpicMd(epic);

  return epic.path;
}

export function addTaskToEpic(epicTitleOrPath: string, taskNameOrPath: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  // Support both title and path
  let epicTitle = epicTitleOrPath;
  let taskName = taskNameOrPath;
  
  if (epicTitleOrPath.includes(path.sep)) {
    epicTitle = path.basename(epicTitleOrPath, '.md');
  }
  if (taskNameOrPath.includes(path.sep)) {
    taskName = path.basename(taskNameOrPath, '.md');
  }

  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicTitle || e.id === epicTitle);
  if (!epic) return;

  const taskPath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, taskName);
  const taskContent = fileService.readFileSyncSafe(taskPath);
  if (!taskContent) return;

  const tm = require('gray-matter')(taskContent);
  const taskId = tm.data._id || tm.data.id || path.basename(taskName, PROJECT_CONSTANTS.MD_FILE_EXTENSION);

  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const allTasks = dataService.loadTasks();
  const taskObj = allTasks.find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskObj.id, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}

export function addTaskToEpicById(epicId: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.id === epicId || e.name === epicId);
  if (!epic) return;

  if (!epic.tasks) {
    epic.tasks = [];
  }
  
  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const taskObj = dataService.loadTasks().find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskId, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}

export function addTaskToEpicByName(epicName: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicName);
  if (!epic) return;

  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const taskObj = dataService.loadTasks().find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskId, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}

export async function createEpicInteractive() {
  const epicName = await vscode.window.showInputBox({ prompt: 'Epic title' });
  if (!epicName) return;

  const category = await vscode.window.showInputBox({
    prompt: 'Epic category (e.g., SEO, FE, BE)',
    placeHolder: 'MISC'
  });
  const epicCategory = category || 'MISC';

  createEpic(epicName, epicCategory);
  vscode.window.showInformationMessage('Epic created.');
}

export function removeTaskFromEpic(epicTitleOrPath: string, taskPath: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  let epicTitle = epicTitleOrPath;
  if (epicTitleOrPath.includes(path.sep)) {
    epicTitle = path.basename(epicTitleOrPath, '.md');
  }
  const taskName = path.basename(taskPath, '.md');

  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicTitle || e.id === epicTitle);
  if (!epic) return;

  epic.tasks = epic.tasks.filter(t => t !== taskName);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskName);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

export function removeTaskFromEpicById(epicId: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.id === epicId || e.name === epicId);
  if (!epic || !epic.tasks) return;

  epic.tasks = epic.tasks.filter(t => t !== taskId);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskId);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

export function removeTaskFromEpicByName(epicName: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicName);
  if (!epic) return;

  epic.tasks = epic.tasks.filter(t => t !== taskId);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskId);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

export function getEpics(ws: string): Epic[] {
  const dataService = getDataService(ws);
  return dataService.loadEpics();
}

export function getEpic(epicId: string): Epic | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getEpic(epicId);
}

export function updateEpic(epicId: string, updates: Partial<Epic>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateEpic(epicId, updates);
  const updated = dataService.getEpic(epicId);
  if (updated) dataService.saveEpicMd(updated);
}

export function deleteEpic(epicId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteEpic(epicId);
}

export function listEpics(ws: string): string[] {
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epicsDir = fileService.getEpicsDir(ws);
  
  return epics.map(epic => {
    const filename = dataService.getEpicFilename(epic);
    return require('path').join(epicsDir, filename);
  });
}

export function readEpic(filePath: string): string {
  const dataService = getDataService(fileService.getWorkspaceRoot());
  return fs.readFileSync(filePath, 'utf8');
}

export function getTasksFromEpic(epicName: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const epic = dataService.loadEpics().find(e => e.name === epicName || e.id === epicName);
  if (!epic) return [];
  
  const tasks = dataService.loadTasks();
  const config = dataService.loadConfig();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => epic.tasks.includes(t.id)).map(t => {
    const filename = dataService.getTaskFilename(t);
    return {
      label: t.title,
      path: require('path').join(tasksDir, filename),
      id: t.id
    };
  });
}

export function getTasksFromEpicById(epicId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const epic = dataService.loadEpics().find(e => e.id === epicId);
  if (!epic) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => epic.tasks.includes(t.id)).map(t => {
    const filename = dataService.getTaskFilename(t);
    return {
      label: t.title,
      path: require('path').join(tasksDir, filename),
      id: t.id
    };
  });
}

import * as fs from 'fs';