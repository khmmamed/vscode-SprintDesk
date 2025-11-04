import matter, { test } from "gray-matter";
import path from "path";
import fs from "fs";
import { getTasksPath } from "../utils/backlogUtils";
import * as fileService from "../services/fileService";
import { getEpicPath } from "./epicController";
import { getTaskPath } from "../utils/taskUtils";

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

/* update operations */
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

  const epicMeta = {
    _id: epicFile.data._id,
    title: epicFile.data.title,
    path: epicFile.data.path
  };

  const lines = taskFile.content.split('\n');

  const updateEpicHeaderLine = (ls: string[]): string[] => {
    const taskHeaderIdx = ls.findIndex(l => l.trim().startsWith('# 🧩 Task'));
    if (taskHeaderIdx === -1) return [`📘 Epic: \`${epicMeta.title}\``, ...ls];

    const afterTask = taskHeaderIdx + 1;
    return ls.map((line, i) =>
      i === afterTask && line.trim().startsWith('📘 Epic:')
        ? `📘 Epic: \`${epicMeta.title}\``
        : i === afterTask && !line.trim().startsWith('📘 Epic:')
        ? [line, `📘 Epic: \`${epicMeta.title}\``]
        : line
    ).flat();
  };

  const updateEpicSection = (ls: string[]): string[] => {
    const secIdx = ls.findIndex(l => l.trim() === '## Epic');
    const link = `- [${epicMeta.title}](${epicMeta.path})`;

    if (secIdx === -1) return [...ls, '## Epic', link];

    const nextIdx = secIdx + 1;
    return ls.map((line, i) =>
      i === nextIdx ? link : line
    );
  };

  const updatedLines = updateEpicSection(updateEpicHeaderLine(lines));

  const updatedMeta = { ...taskFile.data, epic: epicMeta };

  fs.writeFileSync(
    getTaskPath(taskName),
    matter.stringify(updatedLines.join('\n'), updatedMeta),
    'utf-8'
  );
};