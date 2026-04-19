import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { promptInput, promptPick } from '../utils/helpers';
import * as fileService from './fileService';
import { getPriorityOptions, getTaskTypeOptions } from '../utils/helpers';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import * as taskController from '../controller/taskController';
import { 
  generateEpicContent,
  generateEpicTemplate
} from '../utils/epicTemplate';
import { getEpicTasks } from '../controller/epicController';
import { relativePathTaskToTaskpath } from '../utils/taskUtils';
import { generateEpicName } from '../utils/epicTemplate';
import { SprintDeskItem } from '../utils/SprintDeskItem';
import { getDataService } from '../data/DataService';
import { Epic } from '../data/types';

// [vNext] : next file version v0.0.2

export async function createNewEpic(epicMetadata: SprintDesk.EpicMetadata): Promise<SprintDesk.EpicMetadata> {
  const ws = fileService.getWorkspaceRoot();
  const title = epicMetadata.title || await promptInput('Epic Title');
  if (!title) throw new Error('Epic title is required');
  const dataService = getDataService(ws);

  // Use DataService as source of truth
  const epicId = dataService.generateId('epic');
  const epic: Epic = {
    id: epicId,
    name: title,
    description: epicMetadata.description || '',
    status: (epicMetadata.status as any) || 'planned',
    priority: (epicMetadata.priority as any) || 'medium',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  dataService.addEpic(epic);
  // ensure markdown is generated from data
  dataService.saveEpicMd(epic);

  return {
    _id: undefined as any,
    title: epic.name,
    status: epic.status as any,
    priority: epic.priority as any,
    createdAt: epic.createdAt,
    updatedAt: epic.updatedAt,
    totalTasks: 0,
    completedTasks: 0,
    path: path.join(fileService.getEpicsDir(ws), `${epic.id}.md`)
  } as SprintDesk.EpicMetadata;
}












// [vPrevious]
export function createEpicFromMetadata(metadata: SprintDesk.EpicMetadata): string {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');

  const dataService = getDataService(ws);
  const epicId = dataService.generateId('epic');
  const epic: Epic = {
    id: epicId,
    name: metadata.title,
    description: metadata.description || '',
    status: (metadata.status as any) || 'planned',
    priority: (metadata.priority as any) || 'medium',
    tasks: [],
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: metadata.updatedAt || new Date().toISOString()
  };

  dataService.addEpic(epic);
  dataService.saveEpicMd(epic);

  return path.join(fileService.getEpicsDir(ws), `${epic.id}.md`);
}
interface TreeItemLike {
  label: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  // absolute path if file exists
  path?: string;
  // relative path as listed in backlog frontmatter or link
  rel?: string;
  command?: {
    command: string;
    title: string;
    arguments: any[];
  };
}
export function listEpics(ws: string): string[] {
  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  if (!fs.existsSync(epicsDir)) {
    fs.mkdirSync(epicsDir, { recursive: true });
    return [];
  }
  return fileService.listMdFiles(epicsDir).map(f => path.join(epicsDir, f));
}

export function createEpic(name: string): string {
  return createEpicFromMetadata({
    title: name,
    status: 'planned',
    priority: 'medium'
  });
}
export function readEpic(filePath: string): string {
  // Use SprintDeskItem class to read epic content
  try {
    const epicItem = new SprintDeskItem(filePath);
    return epicItem.getContent();
  } catch (error) {
    console.error('❌ Failed to read epic with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    return fs.readFileSync(filePath, 'utf8');
  }
}

export function updateEpic(filePath: string, content: string) {
  // Use SprintDeskItem class to update epic content
  try {
    const epicItem = new SprintDeskItem(filePath);
    epicItem.update(content);
    console.log(`✅ Epic content updated using SprintDeskItem: ${filePath}`);
  } catch (error) {
    console.error('❌ Failed to update epic with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

export function deleteEpic(filePath: string) {
  if (fs.existsSync(filePath)) {
    // Use SprintDeskItem class to delete epic
    try {
      const epicItem = new SprintDeskItem(filePath);
      epicItem.delete();
      console.log(`✅ Epic deleted using SprintDeskItem: ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to delete epic with SprintDeskItem, falling back to original method:', error);
      
      // Fallback to original method
      fs.unlinkSync(filePath);
    }
  }
}
export function addTaskToEpic(epicTitle: string, taskName: string) {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');

  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicTitle || e.id === epicTitle);
  if (!epic) throw new Error('Epic not found');

  // read task file to get task id and title
  const taskPath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, taskName);
  const taskContent = fileService.readFileSyncSafe(taskPath);
  if (!taskContent) throw new Error('Task file not found');
  const tm = require('gray-matter')(taskContent);
  const taskId = tm.data._id || tm.data.id || path.basename(taskName, PROJECT_CONSTANTS.MD_FILE_EXTENSION);

  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  // update counts
  const allTasks = dataService.loadTasks();
  const epicTasks = allTasks.filter(t => epic.tasks.includes(t.id));
  const completed = epicTasks.filter(t => (t.status as string) === 'done' || (t.status as string) === 'completed').length;

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  // update task epic field
  const taskObj = allTasks.find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskObj.id, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}
 
export async function createEpicInteractive() {
  const epicName = await (vscode.window.showInputBox as any)({ prompt: 'Epic title' });
  if (!epicName) return;
  createEpic(epicName);
  vscode.window.showInformationMessage('Epic created.');
}
export function getTasksFromEpic(epicName: string): TreeItemLike[] {
  try {
    const tasks = getEpicTasks(epicName);

    return tasks.map((t: any) => {
      const label = path.basename(t.path || '');
      const absPath = t.path;
      return { 
        label, 
        absPath, 
        collapsibleState: vscode.TreeItemCollapsibleState.None, 
        path: relativePathTaskToTaskpath(t.path) 
      };
    });
  } catch (e) {
     throw new Error('No tasks found.');
  }
}
