import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { addTaskToEpic } from './epicService';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import * as epicController from '../controller/epicController';

import { 
  generateTaskFile,
  generateTaskTemplate, 
} from '../utils/taskTemplate';


export async function createTask(metadata: SprintDesk.TaskMetadata): Promise<{ filePath: string; taskName: string }> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
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
  
  // Get task metadata
  const taskTitle = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    placeHolder: UI_CONSTANTS.QUICK_PICK.TASK_TITLE
  });
  if (!taskTitle) return;

  // Get task type
  const type = await vscode.window.showQuickPick([
  { label: TASK_CONSTANTS.TYPE.FEATURE, description: 'New functionality', value: 'feature' as SprintDesk.TaskType },
  { label: TASK_CONSTANTS.TYPE.BUG, description: 'Fix an issue', value: 'bug' as SprintDesk.TaskType },
  { label: TASK_CONSTANTS.TYPE.IMPROVEMENT, description: 'Enhancement to existing feature', value: 'improvement' as SprintDesk.TaskType },
  { label: TASK_CONSTANTS.TYPE.DOCUMENTATION, description: 'Documentation updates', value: 'documentation' as SprintDesk.TaskType },
  { label: TASK_CONSTANTS.TYPE.TEST, description: 'Test implementation', value: 'test' as SprintDesk.TaskType }
  ], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  // Get priority
  const priority = await vscode.window.showQuickPick([
  { label: `${UI_CONSTANTS.EMOJI.PRIORITY.HIGH} High`, description: 'Critical or urgent', value: 'high' as SprintDesk.Priority },
  { label: `${UI_CONSTANTS.EMOJI.PRIORITY.MEDIUM} Medium`, description: 'Important but not urgent', value: 'medium' as SprintDesk.Priority },
  { label: `${UI_CONSTANTS.EMOJI.PRIORITY.LOW} Low`, description: 'Nice to have', value: 'low' as SprintDesk.Priority }
  ], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  // Get category
  const category = await vscode.window.showInputBox({
    prompt: 'Enter category (optional)',
    placeHolder: UI_CONSTANTS.QUICK_PICK.CATEGORY
  });

  // Get component
  const component = await vscode.window.showInputBox({
    prompt: 'Enter component (optional)',
    placeHolder: UI_CONSTANTS.QUICK_PICK.COMPONENT
  });

  // Get duration estimate
  const duration = await vscode.window.showInputBox({
    prompt: 'Enter duration estimate (optional)',
    placeHolder: UI_CONSTANTS.QUICK_PICK.DURATION
  });

  // Get assignee
  const assignee = await vscode.window.showInputBox({
    prompt: 'Enter assignee (optional)',
    placeHolder: UI_CONSTANTS.QUICK_PICK.ASSIGNEE
  });
  // create task and get metadata
  const task = await createTask({
      title: taskTitle,
      type: type.value,
      priority: priority.value,
      category,
      component,
      duration,
      assignee,
      status: TASK_CONSTANTS.STATUS.WAITING as SprintDesk.TaskStatus,
    });

  console.log('Created task: ', task);
  // Get epic
  const epic = await epicController.handleEpicInputsController(ws);

  console.log('Selected epic: ', epic);

  // when create task add it to epic
  // when epic created add it to task

  // try {
  //   const task = createTask({
  //     title: taskTitle,
  //     type: type.value,
  //     priority: priority.value,
  //     category,
  //     component,
  //     duration,
  //     assignee,
  //     status: TASK_CONSTANTS.STATUS.WAITING as SprintDesk.TaskStatus,
  //     epic: {
  //       _id: epic?._id,
  //       title: epic?.title || '',
  //       path: epic?.path
  //     }
  //   });

  //   if (epic?._id && epic.title) {
  //     await addTaskToEpic(epic.title, task.taskName);
  //   }

  //   vscode.window.showInformationMessage('Task created successfully.');
  // } catch (e) {
  //   vscode.window.showErrorMessage('Failed to create task.');
  // }
}
