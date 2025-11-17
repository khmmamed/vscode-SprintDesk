import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import * as epicController from '../controller/epicController';

import { 
  generateTaskFile,
  generateTaskTemplate, 
} from '../utils/taskTemplate';

// [vNext]: version: 0.0.2
export async function createTask(ws: string, metadata: SprintDesk.TaskMetadata): Promise<{ filePath: string; taskName: string }> {
  if (!ws){
    ws = fileService.getWorkspaceRoot();
  };
  const tasksDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
  fs.mkdirSync(tasksDir, { recursive: true });

  const taskName = generateTaskFile(metadata.title, metadata.epic?.title);
  const taskPath = path.join(tasksDir, taskName);
  
  if (!fs.existsSync(taskPath)) {
    const content = generateTaskTemplate(metadata);
    fs.writeFileSync(taskPath, content, 'utf8');
  }
  
  return { filePath: taskPath, taskName };
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
  
  const task = await epicController.handleEpicInputsController(ws);

  console.log('Created task: ', task);
  // Get epic
  const epic = await epicController.handleEpicInputsController(ws);

  console.log('Selected epic: ', epic);
}
