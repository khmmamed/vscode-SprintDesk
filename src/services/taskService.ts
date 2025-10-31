import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { createEpicFromMetadata, addTaskToEpic, listEpics } from './epicService';
import { PROJECT, TASK, UI } from '../utils/constant';

import { 
  generateTaskContent, 
  generateTaskFileName, 
  parseTaskMetadataFromFilename 
} from '../utils/templateUtils';
import { TaskMetadata, EpicMetadata, TaskType, Priority, EpicStatus } from '../types/types';

export function listTasks(ws: string): string[] {
  const tasksDirs = fileService.getExistingTasksDirs(ws);
  const files: string[] = [];
  for (const d of tasksDirs) {
    const entries = fileService.listMdFiles(d);
    files.push(...entries.map(f => path.join(d, f)));
  }
  return files;
}

export function readTask(filePath: string): string {
  return fileService.readFileSyncSafe(filePath);
}

export function createTask(metadata: TaskMetadata): { filePath: string; fileName: string } {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const tasksDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR);
  fs.mkdirSync(tasksDir, { recursive: true });

  const fileName = generateTaskFileName(metadata.title, metadata.epicName);
  const taskPath = path.join(tasksDir, fileName);
  
  if (!fs.existsSync(taskPath)) {
    const content = generateTaskContent(metadata);
    fs.writeFileSync(taskPath, content, 'utf8');
  }
  
  return { filePath: taskPath, fileName };
}

export function updateTask(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteTask(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export async function createTaskInteractive() {
  // Get workspace
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace open');
    return;
  }

  // Get task metadata
  const taskName = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    placeHolder: UI.QUICK_PICK.TASK_TITLE
  });
  if (!taskName) return;

  // Get task type
  const type = await vscode.window.showQuickPick([
    { label: TASK.TYPE.FEATURE, description: 'New functionality', value: 'feature' as TaskType },
    { label: TASK.TYPE.BUG, description: 'Fix an issue', value: 'bug' as TaskType },
    { label: TASK.TYPE.IMPROVEMENT, description: 'Enhancement to existing feature', value: 'improvement' as TaskType },
    { label: TASK.TYPE.DOCUMENTATION, description: 'Documentation updates', value: 'documentation' as TaskType },
    { label: TASK.TYPE.TEST, description: 'Test implementation', value: 'test' as TaskType }
  ], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  // Get priority
  const priority = await vscode.window.showQuickPick([
    { label: `${UI.EMOJI.PRIORITY.HIGH} High`, description: 'Critical or urgent', value: 'high' as Priority },
    { label: `${UI.EMOJI.PRIORITY.MEDIUM} Medium`, description: 'Important but not urgent', value: 'medium' as Priority },
    { label: `${UI.EMOJI.PRIORITY.LOW} Low`, description: 'Nice to have', value: 'low' as Priority }
  ], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  // Get category
  const category = await vscode.window.showInputBox({
    prompt: 'Enter category (optional)',
    placeHolder: UI.QUICK_PICK.CATEGORY
  });

  // Get component
  const component = await vscode.window.showInputBox({
    prompt: 'Enter component (optional)',
    placeHolder: UI.QUICK_PICK.COMPONENT
  });

  // Get duration estimate
  const duration = await vscode.window.showInputBox({
    prompt: 'Enter duration estimate (optional)',
    placeHolder: UI.QUICK_PICK.DURATION
  });

  // Get assignee
  const assignee = await vscode.window.showInputBox({
    prompt: 'Enter assignee (optional)',
    placeHolder: UI.QUICK_PICK.ASSIGNEE
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

  let epicName = selected.value;
  let epicId: string | undefined;

  if (epicName === '__new__') {
    // Create new epic
    const newEpicName = await vscode.window.showInputBox({ 
      prompt: 'New epic name',
      placeHolder: UI.QUICK_PICK.EPIC_NAME
    });
    if (!newEpicName) return;
    
    const epicPriority = await vscode.window.showQuickPick([
      { label: `${UI.EMOJI.PRIORITY.HIGH} High`, value: 'high' as Priority },
      { label: `${UI.EMOJI.PRIORITY.MEDIUM} Medium`, value: 'medium' as Priority },
      { label: `${UI.EMOJI.PRIORITY.LOW} Low`, value: 'low' as Priority }
    ], {
      placeHolder: 'Select epic priority'
    });
    if (!epicPriority) return;

    const owner = await vscode.window.showInputBox({
      prompt: 'Epic owner (optional)',
      placeHolder: UI.QUICK_PICK.EPIC_OWNER
    });

    epicName = newEpicName;
    epicId = `${PROJECT.ID_PREFIX.EPIC}${epicName.replace(/\s+/g, '_').toLowerCase()}`;
    
    const epicMetadata: EpicMetadata = {
      title: newEpicName,
      priority: epicPriority.value,
      owner: owner || undefined,
      type: type.value,
      status: '⏳ Planned' as EpicStatus
    };
    createEpicFromMetadata(epicMetadata);
  } else if (epicName) {
    epicId = `${PROJECT.ID_PREFIX.EPIC}${epicName.replace(/\s+/g, '_').toLowerCase()}`;
  }

  try {
    const task = createTask({
      title: taskName,
      type: type.value,
      priority: priority.value,
      category,
      component,
      duration,
      assignee,
      status: 'not-started',
      epicName: epicName || undefined,
      epicId
    });

    if (epicName) {
      await addTaskToEpic(epicName, task.fileName);
    }

    vscode.window.showInformationMessage('Task created successfully.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to create task.');
  }
}
