import * as fs from 'fs';
import * as path from 'path';
import { getBacklogPath, getBacklogsPath } from '../utils/backlogUtils';
import matter from 'gray-matter';
import { UI } from '../utils/constant';

interface ITask {
  _id: string;
  name: string;
  status: string;
  priority: string;
  path: string;
}

export function getBacklogs(): string[] {
  const tasksPath = getBacklogsPath();
  if (!fs.existsSync(tasksPath)) return [];

  const files = fs.readdirSync(tasksPath);
  // filter only .md files and return basename without extension
  const taskNames = files
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));

  return taskNames;
}
export function getBacklogMetadata(backlogName: string): { [key: string]: any; } {
  const backlogPath = getBacklogPath(backlogName);
  const { data } = matter.read(backlogPath);
  return data;
}
export function getBacklogContent(backlogFile: string): { [key: string]: any; } {
  const { data } = matter.read(backlogFile);
  return data;
}
export function getBacklogDescription(backlogName: string): string {
  const { description } = getBacklogMetadata(backlogName);
  return description;
}
export function getBacklogTasks(backlogName: string): ITask[] {
  const { tasks } = getBacklogMetadata(backlogName);
  return tasks;
}
/* Tasks Operations */
export function addTaskToBacklog(backlogPath: string, taskPath: string): void {
  const { data: taskMetadata } = matter.read(taskPath);
  const { data: backlogMetadata, content: backlogContent } = matter.read(backlogPath);

  const existingTaskIndex = backlogMetadata.tasks ? backlogMetadata.tasks.findIndex((t: any) => t._id === taskMetadata._id) : -1;
  if (existingTaskIndex === -1) {
    // Add task to markdown section
    const tasksSectionMarker = UI.SECTIONS.TASKS_MARKER;
    let content = backlogContent;
    if (!content.includes(tasksSectionMarker)) {
      content += `\n\n${tasksSectionMarker}\n`;
    }
    const taskPathFormatted = path.relative(path.dirname(backlogPath), taskPath).replace(/\\/g, '/');
    const taskLink = `- [${taskMetadata.title}](${taskPathFormatted})`;
    const tasksIndex = content.indexOf(tasksSectionMarker);

    if (tasksIndex !== -1) {
      content = content.slice(0, tasksIndex + tasksSectionMarker.length) +
        '\n' + taskLink +
        content.slice(tasksIndex + tasksSectionMarker.length);
    }
    // Add task to YAML frontmatter
    const task = {
      _id: taskMetadata._id,
      title: taskMetadata.title,
      priority: taskMetadata.priority || 'Medium',
      status: taskMetadata.status || 'Not Started',
      path: taskPathFormatted
    };

    if (!backlogMetadata.tasks) {
      backlogMetadata.tasks = [];
    }
    backlogMetadata.tasks.push(task);
    // Write updated content with both markdown and frontmatter changes
    const updatedContent = matter.stringify(content, backlogMetadata);
    fs.writeFileSync(backlogPath, updatedContent);
  } else {
    console.log(`Task with ID ${taskMetadata._id} already exists in backlog.`);
    return;
  }

}