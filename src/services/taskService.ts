import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import * as epicController from '../controller/epicController';
import * as taskController from '../controller/taskController';
import { SprintDeskItem } from '../utils/SprintDeskItem';

import {
  generateTaskFile,
  generateTaskMetadata,
  generateTaskContent,
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
  const taskPath = path.join(tasksDir, taskName);

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
    path: taskPath, // Use absolute path for TaskTreeItem
    relativePath: fileService.createTaskRelativePath(taskBaseName), // Keep relative path for reference
    epic: taskMetadata.epic, // Include epic if provided
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  // Use SprintDeskItem class to create the task
  try {
    // Generate the task content using existing template
    const taskContent = generateTaskMetadata(taskData) + '\n\n' + generateTaskContent(taskData);
    
    // First write the file directly since SprintDeskItem expects file to exist for parsing
    fs.writeFileSync(taskPath, taskContent, 'utf8');
    
    // Now create SprintDeskItem instance and ensure metadata is properly set
    const taskItem = new SprintDeskItem(taskPath);
    
    // Ensure the path is set correctly in metadata
    taskItem.updateMetadata({ path: taskPath });
    
    console.log(`✅ Task created successfully using SprintDeskItem: ${taskPath}`);
  } catch (error) {
    console.error('❌ Failed to create task with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method if SprintDeskItem fails
    fs.writeFileSync(taskPath, generateTaskTemplate(taskData), 'utf8');
  }

  return taskData;
}





















/* [vPrevious] */

export function updateTask(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteTask(filePath: string) {
  if (fs.existsSync(filePath)) {
    // Use SprintDeskItem class to delete task
    try {
      const taskItem = new SprintDeskItem(filePath);
      taskItem.delete();
      console.log(`✅ Task deleted using SprintDeskItem: ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to delete task with SprintDeskItem, falling back to original method:', error);
      
      // Fallback to original method
      fs.unlinkSync(filePath);
    }
  }
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
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
