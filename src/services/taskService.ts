import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { createEpicFromMetadata, addTaskToEpic, listEpics, createEpic } from './epicService';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';

import { 
  generateTaskFile,
  generateTaskTemplate, 
} from '../utils/taskTemplate';
import { generateEpicTemplate } from '../utils/epicTemplate';



export function createTask(metadata: SprintDesk.TaskMetadata): { filePath: string; taskName: string } {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const tasksDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
  fs.mkdirSync(tasksDir, { recursive: true });

  const taskName = generateTaskFile(metadata.title, metadata.epicTitle);
  const taskPath = path.join(tasksDir, taskName);
  
  if (!fs.existsSync(taskPath)) {
    const content = generateTaskTemplate(metadata);
    fs.writeFileSync(taskPath, content, 'utf8');
  }
  
  return { filePath: taskPath, taskName };
}

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

  // Get epic list and show quickpick
  const epics = listEpics(ws).map((epicPath: string) => path.basename(epicPath).replace(/^\[Epic\]_/, '').replace(/\.md$/, ''));
  const epicOptions = [
    { label: '$(add) Create new epic...', value: '__new__' },
    { label: '$(circle-slash) No epic', value: '' },
    ...epics.map((epic: string) => ({ label: `$(bookmark) ${epic}`, value: epic }))
  ];

  const selected = await vscode.window.showQuickPick(epicOptions, {
    placeHolder: 'Select or create an epic'
  });

  if (!selected) return; // User cancelled

  let epicTitle = selected.value;
  let epicId: string | undefined;

  if (epicTitle === '__new__') {
    // Create new epic
    const newEpicName = await vscode.window.showInputBox({ 
      prompt: 'New epic title',
      placeHolder: UI_CONSTANTS.QUICK_PICK.EPIC_TITLE
    });
    if (!newEpicName) return;
    
    const epicPriority = await vscode.window.showQuickPick([
      { label: `${UI_CONSTANTS.EMOJI.PRIORITY.HIGH} High`, value: 'high' as SprintDesk.Priority },
      { label: `${UI_CONSTANTS.EMOJI.PRIORITY.MEDIUM} Medium`, value: 'medium' as SprintDesk.Priority },
      { label: `${UI_CONSTANTS.EMOJI.PRIORITY.LOW} Low`, value: 'low' as SprintDesk.Priority }
    ], {
      placeHolder: 'Select epic priority'
    });
    if (!epicPriority) return;

    const owner = await vscode.window.showInputBox({
      prompt: 'Epic owner (optional)',
      placeHolder: UI_CONSTANTS.QUICK_PICK.EPIC_OWNER
    });

    epicTitle = newEpicName;
    epicId = `${PROJECT_CONSTANTS.ID_PREFIX.EPIC}${epicTitle.replace(/\s+/g, '_').toLowerCase()}`;
    
    const epicMetadata: SprintDesk.EpicMetadata = {
      title: newEpicName,
      priority: epicPriority.value,
      owner: owner || undefined,
      type: type.value,
      status: 'planned' as SprintDesk.EpicStatus
    };
    createEpicFromMetadata(epicMetadata);
  } else if (epicTitle) {
    epicId = `${PROJECT_CONSTANTS.ID_PREFIX.EPIC}${epicTitle.replace(/\s+/g, '_').toLowerCase()}`;
  }

  try {
    const task = createTask({
      title: taskTitle,
      type: type.value,
      priority: priority.value,
      category,
      component,
      duration,
      assignee,
      status: TASK_CONSTANTS.STATUS.WAITING as SprintDesk.TaskStatus,
      epicTitle: epicTitle || undefined,
      epicId
    });

    if (epicTitle) {
      await addTaskToEpic(epicTitle, task.taskName);
    }

    vscode.window.showInformationMessage('Task created successfully.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to create task.');
  }
}
