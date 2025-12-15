/**
 * Controller: taskController.ts
 * Description: This controller handles operations related to tasks in the SprintDesk application.
 * v0.0.1 
 **/
import matter from "gray-matter";
import path from "path";
import fs from "fs";
import { getBacklogPath } from "../utils/backlogUtils";
import * as fileService from "../services/fileService";
import { getTaskPath } from "../utils/taskUtils";
import { updateEpicHeaderLine, updateEpicSection } from "../utils/taskTemplate";
import { TASK_CONSTANTS, UI_CONSTANTS } from "../utils/constant";
import * as vscode from "vscode";
import * as taskService from "../services/taskService";
import * as epicController from "./epicController";
import { promptInput, promptPick, getPriorityOptions, getTaskTypeOptions } from "../utils/helpers";
import { SprintDeskItem } from "../utils/SprintDeskItem";

// [vNext]: version: 0.0.2
export function readTasksIds(): string[] {
  const tasksDir = fileService.getTasksDir(fileService.getWorkspaceRoot());
  const tasksNames = fileService.getTasksNames(tasksDir)
  // map tasks names and read their metadata to get ids
  const tasksIds = tasksNames.map(taskName => {
    const taskPath = path.join(tasksDir, `${taskName}`);
    const { data } = matter.read(taskPath);
    return data._id || '';
  }).filter(_id => _id !== '');
  return tasksIds;
}
export function readTasksTotal(): number {
  const tasksDir = fileService.getTasksDir(fileService.getWorkspaceRoot());
  if (!fs.existsSync(tasksDir)) return 0;
  const files = fs.readdirSync(tasksDir);
  return files.length;
}
export function readTasksNames(): string[] {
  const tasksPath = fileService.getTasksDir(fileService.getWorkspaceRoot());
  if (!fs.existsSync(tasksPath)) return [];

  const files = fs.readdirSync(tasksPath);
  // filter only .md files and return basename without extension
  const taskNames = files
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));

  return taskNames;
}
export async function readAllTasksData(ws?: string): Promise<SprintDesk.ITaskMetadata[]> {
  if (!ws) {
    ws = fileService.getWorkspaceRoot();
  }
  const taskFiles = readTasks(ws);
  const tasksData: SprintDesk.ITaskMetadata[] = taskFiles.map(taskFile => {
    const { data } = matter.read(taskFile);
    return data as SprintDesk.ITaskMetadata;
  });
  return tasksData;
}
export function readTasks(ws: string): string[] {
  const tasksDirs = fileService.getExistingTasksDirs(ws);
  const files: string[] = [];
  for (const d of tasksDirs) {
    const entries = fileService.listMdFiles(d);
    files.push(...entries.map(f => path.join(d, f)));
  }
  return files;
}
export async function handleTaskInputsController(ws?: string, epic?: SprintDesk.EpicMetadata) {
  if (!ws) {
    ws = fileService.getWorkspaceRoot();
  }
  try {
    // Get task metadata
    const taskTitle = await promptInput('Enter task title', UI_CONSTANTS.QUICK_PICK.TASK_TITLE);
    if (!taskTitle) return;

    // Get task type
    const type = await promptPick('Select task type', getTaskTypeOptions());
    if (!type) return;

    // Get priority
    const priority = await promptPick('Select priority', getPriorityOptions());
    if (!priority) return;

    // Get category
    const category = await promptInput('Enter category (optional)', UI_CONSTANTS.QUICK_PICK.CATEGORY);

    // Get component
    const component = await promptInput('Enter component (optional)', UI_CONSTANTS.QUICK_PICK.COMPONENT);

    // Get duration estimate
    const duration = await promptInput('Enter duration estimate (optional)', UI_CONSTANTS.QUICK_PICK.DURATION);

    // Get assignee
    const assignee = await promptInput('Enter assignee (optional)', UI_CONSTANTS.QUICK_PICK.ASSIGNEE);

    // create task and get metadata with epic included
    const task = await taskService.createTask(ws, {
      title: taskTitle,
      type: type.value as SprintDesk.TaskType,
      priority: priority.value as SprintDesk.Priority,
      category,
      component,
      duration,
      assignee,
      status: TASK_CONSTANTS.STATUS.WAITING as SprintDesk.TaskStatus,
      epic: epic ? {
        _id: epic._id,
        title: epic.title,
        path: epic.path
      } : undefined
    });

    return task;
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create task: ${(err as Error).message}`);
  }
}
export async function createTask(ws?: string) {
  if (!ws) {
    ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  // Get epic first
  const epic = await epicController.handleEpicInputsController(ws);

  if (!epic) {
    vscode.window.showWarningMessage('No epic selected. Task will be created without an epic.');
    return;
  }

  // Get task inputs with epic context
  const task = await handleTaskInputsController(ws, epic);

  if (!task) {
    vscode.window.showWarningMessage('Task creation was cancelled or failed.');
    return;
  }

  // Task is now created with epic included, no need for separate addition
  console.log(`✅ Task created with epic: ${task.title} -> ${epic.title}`);
}

export async function addEpicToTask(epic: SprintDesk.EpicMetadata, taskRelativePath: string, ws?: string) {
  if (!ws) {
    ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  const taskPath = fileService.taskRelativePathToAbsolute(taskRelativePath, ws!);
  
  // Use SprintDeskItem class to add epic to task
  try {
    const taskItem = new SprintDeskItem(taskPath);
    taskItem.addEpic(epic.path!);
    console.log(`✅ Epic added to task using SprintDeskItem: ${epic.title} -> ${taskPath}`);
  } catch (error) {
    console.error('❌ Failed to add epic to task with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    await updateTaskEpic(taskPath, epic);
  }
}
export async function updateTaskEpic(taskPath: string, epic: SprintDesk.EpicMetadata): Promise<void> {
  const taskFile = matter.read(taskPath);

  const lines = taskFile.content.split('\n');
  const epicMetaLines = updateEpicHeaderLine(lines, epic);
  const updatedLines = updateEpicSection(epicMetaLines, epic);

  // Sanitize task metadata to avoid undefined values
  const updatedMeta = Object.fromEntries(
    Object.entries({ ...taskFile.data, epic }).map(([k, v]) => [k, v ?? null])
  );

  // Write updated task file
  fs.writeFileSync(
    taskPath,
    matter.stringify(updatedLines.join('\n'), updatedMeta),
    'utf-8'
  );
};




// [vPrevious] : version: 0.0.1


export function readTaskData(filePath: string): SprintDesk.ITaskMetadata {
  // Use SprintDeskItem class to read task data
  try {
    const taskItem = new SprintDeskItem(filePath);
    return taskItem.getMetadata() as SprintDesk.ITaskMetadata;
  } catch (error) {
    console.error('❌ Failed to read task data with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    const { data } = matter(filePath);
    return data as SprintDesk.ITaskMetadata;
  }
}

export function readTaskContent(filePath: string): string {
  // Use SprintDeskItem class to read task content
  try {
    const taskItem = new SprintDeskItem(filePath);
    return taskItem.getContent();
  } catch (error) {
    console.error('❌ Failed to read task content with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    const { content } = matter(filePath);
    return content;
  }
}
export function updateTaskMetadata(taskPath: string, newData: Partial<SprintDesk.ITaskMetadata>): void {
  // Use SprintDeskItem class to update metadata
  try {
    const taskItem = new SprintDeskItem(taskPath);
    taskItem.update(undefined, newData);
    console.log(`✅ Task metadata updated using SprintDeskItem: ${taskPath}`);
  } catch (error) {
    console.error('❌ Failed to update task metadata with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    const parsed = matter(taskPath);
    const updatedData = { ...parsed.data, ...newData };
    const updatedContent = matter.stringify(parsed.content, updatedData);
    fs.writeFileSync(taskPath, updatedContent, 'utf-8');
  }
}
/** Update the content of a markdown file while preserving front-matter */
export const updateTaskContent = (taskPath: string, newContent: string): void => {
  // Use SprintDeskItem class to update content
  try {
    const taskItem = new SprintDeskItem(taskPath);
    taskItem.update(newContent);
    console.log(`✅ Task content updated using SprintDeskItem: ${taskPath}`);
  } catch (error) {
    console.error('❌ Failed to update task content with SprintDeskItem, falling back to original method:', error);
    
    // Fallback to original method
    const parsed = matter.read(taskPath);
    const updatedContent = matter.stringify(newContent, parsed.data);
    fs.writeFileSync(taskPath, updatedContent, 'utf-8');
  }
};
export const updateTaskSlugContent = (
  taskPath: string,
  slug: string,
  partToInsert: string
): void => {
  // Read and parse markdown file
  const parsed = matter.read(taskPath);
  const lines = parsed.content.split('\n');

  // Helper to find slug range
  const findSlugRange = (lines: string[], slug: string) => {
    const start = lines.findIndex(line => line.trim() === `## ${slug}`);
    if (start === -1) return null;
    const end = lines.findIndex(
      line => line.trim().startsWith('## '),
      start + 1
    );
    return { start, end: end === -1 ? lines.length : end };
  };

  const range = findSlugRange(lines, slug);
  if (!range) return;

  // Purely build new lines
  const newLines = [
    ...lines.slice(0, range.start + 1),
    ...lines.slice(range.start + 1, range.end),
    partToInsert,
    ...lines.slice(range.end)
  ];

  // Write back file
  const updatedContent = matter.stringify(newLines.join('\n'), parsed.data);
  fs.writeFileSync(taskPath, updatedContent, 'utf-8');
};

export const updateTaskBacklogs = (taskName: string, backlogName: string): void => {
  const taskPath = getTaskPath(taskName);
  const backlogPath = getBacklogPath(backlogName);
  const { data: taskMetadata, content: taskContent } = matter.read(taskPath);
  const { data: backlogMetadata, content: backlogContent } = matter.read(backlogPath);

  // find backlogs 
  const backlogs = taskMetadata.backlogs || [];
  const backlogIndex = backlogs.findIndex((b: SprintDesk.ITaskBacklog) => b.title === backlogName);
  if (backlogIndex === -1) return;

  // push new backlog info if exist return if not add it
  backlogs[backlogIndex] = {
    _id: backlogMetadata._id || '',
    title: backlogMetadata.title || backlogName,
    path: backlogMetadata.path || ''
  };

  const updatedTaskMetadata = {
    ...taskMetadata,
    backlogs
  };
  const updatedContent = matter.stringify(taskContent, updatedTaskMetadata);
  fs.writeFileSync(taskPath, updatedContent, 'utf-8');
};
