import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { createEpicFromMetadata, addTaskToEpic, listEpics } from './epicService';

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
  const tasksDir = path.join(ws, '.SprintDesk', 'tasks');
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
    placeHolder: 'e.g., Implement Login Feature'
  });
  if (!taskName) return;

  // Get task type
  const type = await vscode.window.showQuickPick([
    { label: '$(tools) Feature', description: 'New functionality', value: 'feature' as TaskType },
    { label: '$(bug) Bug', description: 'Fix an issue', value: 'bug' as TaskType },
    { label: '$(arrow-up) Improvement', description: 'Enhancement to existing feature', value: 'improvement' as TaskType },
    { label: '$(book) Documentation', description: 'Documentation updates', value: 'documentation' as TaskType },
    { label: '$(beaker) Test', description: 'Test implementation', value: 'test' as TaskType }
  ], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  // Get priority
  const priority = await vscode.window.showQuickPick([
    { label: '🟢 High', description: 'Critical or urgent', value: 'high' as Priority },
    { label: '🟡 Medium', description: 'Important but not urgent', value: 'medium' as Priority },
    { label: '🔴 Low', description: 'Nice to have', value: 'low' as Priority }
  ], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  // Get category
  const category = await vscode.window.showInputBox({
    prompt: 'Enter category (optional)',
    placeHolder: 'e.g., frontend, backend, testing'
  });

  // Get component
  const component = await vscode.window.showInputBox({
    prompt: 'Enter component (optional)',
    placeHolder: 'e.g., authentication, database, ui'
  });

  // Get duration estimate
  const duration = await vscode.window.showInputBox({
    prompt: 'Enter duration estimate (optional)',
    placeHolder: 'e.g., 2d, 4h, 1w'
  });

  // Get assignee
  const assignee = await vscode.window.showInputBox({
    prompt: 'Enter assignee (optional)',
    placeHolder: 'e.g., John Doe'
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
      placeHolder: 'e.g., User Authentication'
    });
    if (!newEpicName) return;
    
    const epicPriority = await vscode.window.showQuickPick([
      { label: '🟢 High', value: 'high' as Priority },
      { label: '🟡 Medium', value: 'medium' as Priority },
      { label: '🔴 Low', value: 'low' as Priority }
    ], {
      placeHolder: 'Select epic priority'
    });
    if (!epicPriority) return;

    const owner = await vscode.window.showInputBox({
      prompt: 'Epic owner (optional)',
      placeHolder: 'e.g., Team Lead'
    });

    epicName = newEpicName;
    epicId = `epic_${newEpicName.replace(/\s+/g, '_').toLowerCase()}`;
    
    const epicMetadata: EpicMetadata = {
      title: newEpicName,
      priority: epicPriority.value,
      owner: owner || undefined,
      type: type.value,
      status: '⏳ Planned' as EpicStatus
    };
    createEpicFromMetadata(epicMetadata);
  } else if (epicName) {
    epicId = `epic_${epicName.replace(/\s+/g, '_').toLowerCase()}`;
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
