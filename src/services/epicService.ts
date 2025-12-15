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

// [vNext] : next file version v0.0.2

export async function createNewEpic(epicMetadata: SprintDesk.EpicMetadata): Promise<SprintDesk.EpicMetadata> {
  const ws = fileService.getWorkspaceRoot();
  const title = epicMetadata.title || await promptInput('Epic Title');
  if (!title) throw new Error('Epic title is required');
  const epicsDir = fileService.getEpicsDir(ws);
  const totalEpics = fileService.getEpicsBaseNames(epicsDir).length;
  // get _id 
  const _id = totalEpics === 0 ? 1 : totalEpics + 1;
  const epicBaseName = fileService.createEpicBaseName(title, _id);
  const epicName = epicBaseName+'.md'
  const epicPath = path.join(fileService.getEpicsDir(ws), epicName);
  
  const epicData: SprintDesk.EpicMetadata = {
    _id,
    title,
    status: epicMetadata.status || 'planned',
    priority: epicMetadata.priority || 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTasks: 0,
    completedTasks: 0,
    path: epicPath
  }

  // Use SprintDeskItem class to create epic
  try {
    const epicItem = new SprintDeskItem(epicPath);
    
    // Generate epic content using existing template
    const epicContent = generateEpicTemplate(epicData);
    
    // Create epic file using SprintDeskItem
    epicItem.update(epicContent, epicData);
    epicItem.create();
    
    console.log(`✅ Epic created successfully using SprintDeskItem: ${epicPath}`);
  } catch (error) {
    console.error('❌ Failed to create epic with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method if SprintDeskItem fails
    fs.writeFileSync(epicPath, generateEpicTemplate(epicData), 'utf8');
  }
  
  return epicData;
}












// [vPrevious]
export function createEpicFromMetadata(metadata: SprintDesk.EpicMetadata): string {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');

  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  fs.mkdirSync(epicsDir, { recursive: true });
  
  const epicName = generateEpicName(metadata.title);
  const epicPath = path.join(epicsDir, epicName);
  
  if (!fs.existsSync(epicPath)) {
    // Use SprintDeskItem class to create epic
    try {
      const epicItem = new SprintDeskItem(epicPath);
      
      // Generate epic content using existing template
      const epicContent = generateEpicTemplate(metadata);
      
      // Create epic file using SprintDeskItem
      epicItem.update(epicContent, metadata);
      epicItem.create();
      
      console.log(`✅ Epic created successfully using SprintDeskItem: ${epicPath}`);
    } catch (error) {
      console.error('❌ Failed to create epic with SprintDeskItem, falling back to original method:', error);
      
      // Fallback to original method if SprintDeskItem fails
      const content = generateEpicTemplate(metadata);
      fs.writeFileSync(epicPath, content, 'utf8');
    }
  }
  
  return epicPath;
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
  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  const epicPath = path.join(epicsDir, generateEpicName(epicTitle));
  
  // Read epic and task files
  const epicContent = fileService.readFileSyncSafe(epicPath);
  if (!epicContent) throw new Error('Epic file not found');
  const taskPath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, taskName);
  const taskContent = fileService.readFileSyncSafe(taskPath);
  if (!taskContent) throw new Error('Task file not found');

  // Parse both files with gray-matter
  const matter = require('gray-matter');
  const epicMatter = matter(epicContent);
  const taskMatter = matter(taskContent);

  // Initialize tasks array if needed
  if (!Array.isArray(epicMatter.data.tasks)) {
    epicMatter.data.tasks = [];
  }

  // Create task data object
  const taskData = {
    _id: taskMatter.data._id,
    title: taskMatter.data.title,
    status: taskMatter.data.status || TASK_CONSTANTS.STATUS.WAITING,
    priority: taskMatter.data.priority || TASK_CONSTANTS.PRIORITY.MEDIUM,
    path: `../${PROJECT_CONSTANTS.TASKS_DIR}/${taskName}`
  };

  // Add task to the tasks array if not already present
  const existingTaskIndex = epicMatter.data.tasks.findIndex((t: any) => t._id === taskData._id);
  if (existingTaskIndex >= 0) {
    epicMatter.data.tasks[existingTaskIndex] = taskData;
  } else {
    epicMatter.data.tasks.push(taskData);
  }

  // Update task counts
  epicMatter.data.totalTasks = epicMatter.data.tasks.length;
  epicMatter.data.completedTasks = epicMatter.data.tasks.filter((t: any) => t.status === 'done' || t.status === 'completed').length;
  epicMatter.data.progress = Math.round((epicMatter.data.completedTasks / epicMatter.data.totalTasks) * 100) + '%';

  // Create task table
  function getStatusEmoji(status: string): string {
    switch (status?.toLowerCase()) {
      case TASK_CONSTANTS.STATUS.WAITING: return UI_CONSTANTS.EMOJI.STATUS.WAITING;
      case TASK_CONSTANTS.STATUS.STARTED: return UI_CONSTANTS.EMOJI.STATUS.IN_PROGRESS;
      case TASK_CONSTANTS.STATUS.DONE:
      case TASK_CONSTANTS.STATUS.COMPLETED: return UI_CONSTANTS.EMOJI.STATUS.DONE;
      case TASK_CONSTANTS.STATUS.BLOCKED: return UI_CONSTANTS.EMOJI.STATUS.BLOCKED;
      default: return UI_CONSTANTS.EMOJI.STATUS.WAITING;
    }
  }

  function getPriorityEmoji(priority: string): string {
    switch (priority?.toLowerCase()) {
      case TASK_CONSTANTS.PRIORITY.HIGH: return UI_CONSTANTS.EMOJI.PRIORITY.HIGH;
      case TASK_CONSTANTS.PRIORITY.LOW: return UI_CONSTANTS.EMOJI.PRIORITY.LOW;
      default: return UI_CONSTANTS.EMOJI.PRIORITY.MEDIUM;
    }
  }

  const taskTable = epicMatter.data.tasks
    .map((task: any, index: number) => {
      const statusEmoji = getStatusEmoji(task.status);
      const priorityEmoji = getPriorityEmoji(task.priority);
      return `| ${index + 1} | [${task.title}](${task.path}) | ${statusEmoji} ${task.status} | ${priorityEmoji} ${task.priority} | \`${task._id}\` |`;
    })
    .join('\n');

  // Replace tasks table in the content
  const tasksSectionStart = epicMatter.content.indexOf(UI_CONSTANTS.SECTIONS.TASKS_MARKER);
  if (tasksSectionStart !== -1) {
    const nextSectionMatch = epicMatter.content.slice(tasksSectionStart).match(/\n##\s/);
    const tasksSectionEnd = nextSectionMatch
      ? tasksSectionStart + nextSectionMatch.index
      : epicMatter.content.length;
    
    epicMatter.content = 
      epicMatter.content.slice(0, tasksSectionStart) +
      `${UI_CONSTANTS.SECTIONS.TASKS_MARKER}\n\n| # | Task | Status | Priority | ID |\n|:--|:-----|:------:|:--------:|:-----|\n${taskTable}\n${UI_CONSTANTS.SECTIONS.AUTO_COMMENT}\n\n` +
      epicMatter.content.slice(tasksSectionEnd);
  }

  // Write the updated epic file
  fs.writeFileSync(epicPath, matter.stringify(epicMatter.content, epicMatter.data));
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
