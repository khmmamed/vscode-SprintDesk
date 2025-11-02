import matter from "gray-matter";
import path from "path";
import fs from "fs";
import { getTasksPath } from "../utils/backlogUtils";


export function getTasks(): string[] {
  const tasksPath = getTasksPath();
  if (!fs.existsSync(tasksPath)) return [];

  const files = fs.readdirSync(tasksPath);
  // filter only .md files and return basename without extension
  const taskNames = files
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));

  return taskNames;
}

