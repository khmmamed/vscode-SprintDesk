/**
 * Controller: taskController.ts
 * Description: This controller handles operations related to tasks in the SprintDesk application.
 * v0.0.1 
 **/
import matter, { test } from "gray-matter";
import path from "path";
import fs from "fs";
import { getBacklogPath } from "../utils/backlogUtils";
import * as fileService from "../services/fileService";
import { getEpicPath, handleEpicInputsController } from "./epicController";
import { getTaskPath } from "../utils/taskUtils";
import { updateEpicHeaderLine, updateEpicSection } from "../utils/taskTemplate";
import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from "../utils/constant";
import * as vscode from "vscode";
import * as epicService from "../services/epicService";
import * as taskService from "../services/taskService";
import { promptInput, promptPick, getPriorityOptions, getTaskTypeOptions } from "../utils/helpers";

// [vNext]
export async function handleTaskInputsController() {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return vscode.window.showErrorMessage('No workspace open');

  try {
    const taskTitle = await promptInput('Enter task title', UI_CONSTANTS.QUICK_PICK.TASK_TITLE);
    if (!taskTitle) return;

    const type = await promptPick('Select task type', getTaskTypeOptions());
    if (!type) return;

    const priority = await promptPick('Select priority', getPriorityOptions());
    if (!priority) return;

    const category = await promptInput('Enter category (optional)', UI_CONSTANTS.QUICK_PICK.CATEGORY);
    const component = await promptInput('Enter component (optional)', UI_CONSTANTS.QUICK_PICK.COMPONENT);
    const duration = await promptInput('Enter duration estimate (optional)', UI_CONSTANTS.QUICK_PICK.DURATION);
    const assignee = await promptInput('Enter assignee (optional)', UI_CONSTANTS.QUICK_PICK.ASSIGNEE);

    const epic = await handleEpicInputsController(ws);

    if (epic?.title) {
      await epicService.addTaskToEpic(epic.title, taskTitle);
    }

    vscode.window.showInformationMessage('Task created successfully.');
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create task: ${(err as Error).message}`);
  }
}
export async function createTask() {
  return handleTaskInputsController();
}
// [vPrevious]
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
export function readTasks(ws: string): string[] {
  const tasksDirs = fileService.getExistingTasksDirs(ws);
  const files: string[] = [];
  for (const d of tasksDirs) {
    const entries = fileService.listMdFiles(d);
    files.push(...entries.map(f => path.join(d, f)));
  }
  return files;
}
export function readTaskData(filePath: string): SprintDesk.ITaskMetadata {
  const { data } = matter(filePath);
  return data as SprintDesk.ITaskMetadata;
}
export function readTaskContent(filePath: string): string {
  const { content } = matter(filePath);
  return content;
}
export function updateTaskMetadata(taskPath: string, newData: Partial<SprintDesk.ITaskMetadata>): void {
  const parsed = matter(taskPath);
  const updatedData = { ...parsed.data, ...newData };
  const updatedContent = matter.stringify(parsed.content, updatedData);
  fs.writeFileSync(taskPath, updatedContent, 'utf-8');
}
/** Update the content of a markdown file while preserving front-matter */
export const updateTaskContent = (taskPath: string, newContent: string): void => {
  // Read file and parse front-matter
  const parsed = matter.read(taskPath);

  // Update content while keeping existing front-matter
  const updatedContent = matter.stringify(newContent, parsed.data);

  // Write back to file
  fs.writeFileSync(taskPath, updatedContent, 'utf-8');
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
export const updateTaskEpic = (taskName: string, epicName: string): void => {
  const taskFile = matter.read(getTaskPath(taskName));
  const epicFile = matter.read(getEpicPath(epicName));

  // Safely extract epic metadata
  const epicMeta = {
    _id: epicFile.data._id ?? null,
    title: epicFile.data.title ?? 'Untitled Epic',
    path: epicFile.data.path ?? ''
  };

  const lines = taskFile.content.split('\n');
  const epicMetaLines = updateEpicHeaderLine(lines, epicMeta);
  const updatedLines = updateEpicSection(epicMetaLines, epicMeta);

  // Sanitize task metadata to avoid undefined values
  const updatedMeta = Object.fromEntries(
    Object.entries({ ...taskFile.data, epic: epicMeta }).map(([k, v]) => [k, v ?? null])
  );

  // Write updated task file
  fs.writeFileSync(
    getTaskPath(taskName),
    matter.stringify(updatedLines.join('\n'), updatedMeta),
    'utf-8'
  );
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
