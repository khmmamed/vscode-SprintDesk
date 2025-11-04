import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as fileService from './fileService';

import { 
  generateEpicContent,
  generateEpicTemplate
} from '../utils/epicTemplate';
// EpicMetadata is provided globally via `src/types/global.d.ts` as SprintDesk.EpicMetadata
import { PROJECT_CONSTANTS, UI_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import { getEpicTasks } from '../controller/epicController';
import { relativePathTaskToTaskpath } from '../utils/taskUtils';
import { generateEpicName } from '../utils/epicTemplate';

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

export function createEpicFromMetadata(metadata: SprintDesk.EpicMetadata): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');

  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  fs.mkdirSync(epicsDir, { recursive: true });
  
  const epicName = generateEpicName(metadata.title);
  const epicPath = path.join(epicsDir, epicName);
  
  if (!fs.existsSync(epicPath)) {
    const content = generateEpicTemplate(metadata);
    fs.writeFileSync(epicPath, content, 'utf8');
  }
  
  return epicPath;
}

export function createEpic(name: string): string {
  return createEpicFromMetadata({
    title: name,
    type: 'feature',
    status: 'planned',
    priority: 'medium'
  });
}

export function readEpic(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function updateEpic(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteEpic(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function addTaskToEpic(epicTitle: string, taskName: string) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
      case TASK_CONSTANTS.STATUS.WAITING: return UI_CONSTANTS.EMOJI.STATUS.NOT_STARTED;
      case TASK_CONSTANTS.STATUS.STARTED: return UI_CONSTANTS.EMOJI.STATUS.IN_PROGRESS;
      case TASK_CONSTANTS.STATUS.DONE:
      case TASK_CONSTANTS.STATUS.COMPLETED: return UI_CONSTANTS.EMOJI.STATUS.DONE;
      case TASK_CONSTANTS.STATUS.BLOCKED: return UI_CONSTANTS.EMOJI.STATUS.BLOCKED;
      default: return UI_CONSTANTS.EMOJI.STATUS.NOT_STARTED;
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
