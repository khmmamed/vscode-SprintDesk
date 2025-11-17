import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import * as epicController from '../controller/epicController';
import * as taskController from '../controller/taskController';

import {
  generateTaskFile,
  generateTaskTemplate,
} from '../utils/taskTemplate';
import { title } from 'process';

// [vNext]: version: 0.0.2
export async function createTask(ws: string, taskMetadata: SprintDesk.TaskMetadata): Promise< SprintDesk.TaskMetadata> {
  if (!ws) {
    ws = fileService.getWorkspaceRoot();
  };
  const tasksDir = fileService.getTasksDir(ws);
  const totalTasks = fileService.getTasksBaseNames(tasksDir).length;
  // get _id 
  const _id = totalTasks === 0 ? 1 : totalTasks + 1;
  const taskBaseName = fileService.createTaskBaseName(taskMetadata.title, _id);
  const taskName = taskBaseName + '.md'
  const taskData: SprintDesk.TaskMetadata = {
    _id,
    title: taskMetadata.title,
    type: taskMetadata.type || 'feature',
    category: taskMetadata.category || '',
    component: taskMetadata.component || '',
    duration: taskMetadata.duration || '',
    assignee: taskMetadata.assignee || '',
    status: taskMetadata.status || 'waiting',
    priority: taskMetadata.priority || 'medium',
    path: fileService.createTaskRelativePath(taskBaseName),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  // write epic file
  fs.writeFileSync(path.join(tasksDir, taskName), generateTaskTemplate(taskData), 'utf8');

  return taskData;
}





















/* [vPrevious] */

export function updateTask(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteTask(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function readTasks(ws: string): string[] {
  // Collect markdown files from existing task directories
  const tasksDirs = fileService.getExistingTasksDirs(ws);
  const files: string[] = [];
  for (const d of tasksDirs) {
    const entries = fileService.listMdFiles(d);
    files.push(...entries.map(f => path.join(d, f)));
  }
  return files;
}

export async function writeTask() {
  // Get workspace
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace open');
    return;
  }

  const task = await taskController.handleTaskInputsController(ws);

  console.log('Created task: ', task);
  // Get epic
  const epic = await epicController.handleEpicInputsController(ws);

  console.log('Selected epic: ', epic);
}
