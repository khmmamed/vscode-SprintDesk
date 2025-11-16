/**
 * Epic Controller Functions
 * @description: controller functions for manipulation epics output and inputs
 * @version: v0.0.2
 * @author: khmamed
 * @copyright: iTTyni.com
 */
import * as fs from 'fs';
import * as path from 'path';
import { getEpicsPath } from '../utils/backlogUtils';
import matter from 'gray-matter';
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import { getTaskPath } from '../utils/taskUtils';
import * as vscode from 'vscode';
import * as fileService from '../services/fileService';
import { getPriorityOptions, promptInput, promptPick } from '../utils/helpers';
import * as epicService from '../services/epicService';

//  [vNext]: next file version v0.0.2
export function readEpicMetadataById(_id: number): SprintDesk.EpicMetadata | undefined {
  return readEpicsMetadata().find(epic => epic._id === _id);
}
export function readEpicsMetadata(): SprintDesk.EpicMetadata[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];
  const epicsDir = fileService.getEpicsDir(ws);
  const epicsNames = fileService.getEpicsNames(epicsDir);
  const epicsMetadata: SprintDesk.EpicMetadata[] = epicsNames.map((epicName: string) => {
    const epicPath = path.join(epicsDir, `${epicName}`);
    const { data } = matter.read(epicPath);
    return data as SprintDesk.EpicMetadata;
  });
  return epicsMetadata;
}
export function readEpicsTitles(): string[] {
  return readEpicsMetadata().map((metadata: any) => metadata.title || '');
}
export const handleEpicInputsController = async (ws: string): Promise<SprintDesk.EpicMetadata | undefined> => {
  // Get Existing epics
  const epics = readEpicsMetadata();
  const epicOptions = [
    { label: '$(add) Create new epic...', value: '__new__' },
    { label: '$(circle-slash) No epic', value: '' },
    ...epics.map((epic: SprintDesk.EpicMetadata) => ({ label: `$(bookmark) ${epic.title}`, value: epic._id }))
  ];
  // 
  const selected = await vscode.window.showQuickPick(epicOptions, {
    placeHolder: 'Select or create an epic'
  });

  if (!selected) return; // User cancelled


  let epicSelected = selected.value;
  let epic = {} as SprintDesk.EpicMetadata;

  if (epicSelected === '__new__') {

    const newEpicTitle = await promptInput('New epic title', UI_CONSTANTS.QUICK_PICK.EPIC_TITLE);
    if (!newEpicTitle) return;

    const epicPriority = await promptPick('Select epic priority (optional)', getPriorityOptions());

    const owner = await promptInput('Epic owner (optional)', UI_CONSTANTS.QUICK_PICK.EPIC_OWNER);
    
    const epicMetadata: SprintDesk.EpicMetadata = {
      title: newEpicTitle,
      priority: epicPriority?.value as SprintDesk.Priority,
      owner: owner,
      status: 'planned' as SprintDesk.EpicStatus
    };

    epic = await epicService.createNewEpic(epicMetadata);
  } else if (epicSelected) {
    epic = readEpicMetadataById(epicSelected! as number)!;
  }

  return epic as SprintDesk.EpicMetadata;
}

// create epic if __new__ is selected


// return epic metadata if existing epic is selected


















// [vPrevious]: version v0.0.1
interface ITask {
  _id: string;
  name: string;
  status: string;
  priority: string;
  path: string;
}

export function getEpics(): string[] {
  const epicsPath = getEpicsPath();
  if (!fs.existsSync(epicsPath)) return [];

  const files = fs.readdirSync(epicsPath);
  // filter only .md files and return basename without extension
  const epicNames = files
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));

  return epicNames;
}

export function getEpicPath(epicName: string): string {
  const epicsPath = getEpicsPath();
  return path.join(epicsPath, `${epicName}`);
}

export function getEpicMetadata(epicName: string): { [key: string]: any; } {
  const epicPath = getEpicPath(epicName);
  const { data } = matter.read(epicPath);
  return data;
}

export function getEpicContent(epicFile: string): { [key: string]: any; } {
  const { data } = matter.read(epicFile);
  return data;
}

export function getEpicDescription(epicName: string): string {
  const { description } = getEpicMetadata(epicName);
  return description;
}

export function getEpicTasks(epicName: string): ITask[] {
  const { tasks } = getEpicMetadata(epicName);
  return tasks;
}

export function getEpicTotalTasks(epicName: string): number {
  const tasks = getEpicTasks(epicName);
  return tasks ? tasks.length : 0;
}

/* Tasks Operations */
export function addTaskToEpic(epicPath: string, taskPath: string): void {
  const { data: taskMetadata } = matter.read(taskPath);
  const { data: epicMetadata, content: epicContent } = matter.read(epicPath);

  const existingTaskIndex = epicMetadata.tasks ?
    epicMetadata.tasks.findIndex((t: any) => t._id === taskMetadata._id) : -1;
  if (existingTaskIndex === -1) {
    // Add task to markdown section
    const tasksSectionMarker = UI_CONSTANTS.SECTIONS.TASKS_MARKER;
    let content = epicContent;
    if (!content.includes(tasksSectionMarker)) {
      content += `\n\n${tasksSectionMarker}\n`;
    }
    const taskPathFormatted = path.relative(path.dirname(epicPath), taskPath).replace(/\\/g, '/');
    const taskLink = `- [${taskMetadata.title || taskMetadata.name}](${taskPathFormatted})`;
    const tasksIndex = content.indexOf(tasksSectionMarker);

    if (tasksIndex !== -1) {
      content = content.slice(0, tasksIndex + tasksSectionMarker.length) +
        '\n' + taskLink +
        content.slice(tasksIndex + tasksSectionMarker.length);
    }
    // Add task to YAML frontmatter
    const task = {
      _id: taskMetadata._id,
      title: taskMetadata.title || taskMetadata.name,
      priority: taskMetadata.priority || 'Medium',
      status: taskMetadata.status || 'Not Started',
      path: taskPathFormatted
    };

    if (!epicMetadata.tasks) {
      epicMetadata.tasks = [task];
    } else {
      epicMetadata.tasks.push(task);
    }
    // Write updated content with both markdown and frontmatter changes
    const updatedContent = matter.stringify(content, epicMetadata);
    fs.writeFileSync(epicPath, updatedContent);
  } else {
    console.log(`Task with ID ${taskMetadata._id} already exists in epic.`);
    return;
  }

}

export function removeTaskFromEpic(epicPath: string, taskPath: string): void {
  const { data: epicMetadata, content: epicContent } = matter.read(epicPath);
  const { data: taskMetadata } = matter.read(taskPath);
  const taskIndex = epicMetadata.tasks ?
    epicMetadata.tasks.findIndex((t: any) => t._id === taskMetadata._id) : -1;

  if (taskIndex !== -1) {
    // remove from epic metadata
    const tasks = epicMetadata.tasks.filter((task: ITask) => task._id !== taskMetadata._id);
    epicMetadata.tasks = tasks;
    // Remove task from markdown section
    const taskPathFormatted = path.relative(path.dirname(epicPath), taskPath).replace(/\\/g, '/');
    const taskLinkPattern = new RegExp(`^- \\[.*\\]\\(${taskPathFormatted.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\)\\s*`, 'm');
    const updatedEpicContent = epicContent.replace(taskLinkPattern, '').trim();
    // Write updated content with both markdown and frontmatter changes
    const updatedContent = matter.stringify(updatedEpicContent, epicMetadata);
    fs.writeFileSync(epicPath, updatedContent);
  } else {
    console.log(`Task with ID ${taskMetadata._id} not found in epic.`);
  }
}

export function updateEpicTasks(epicName: string, taskName: string): void {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  const epicPath = path.join(epicsDir, epicName);

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