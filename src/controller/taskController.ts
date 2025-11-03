import matter from "gray-matter";
import path from "path";
import fs from "fs";
import { getTasksPath } from "../utils/backlogUtils";
import * as fileService from "../services/fileService";

export function readTasksNames(): string[] {
  const tasksPath = getTasksPath();
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