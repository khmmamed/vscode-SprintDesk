import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as fileService from './fileService';
import insertTaskLinkUnderSection from '../utils/mdUtils';
import {
  PROJECT_CONSTANTS,
  TASK_CONSTANTS,
  UI_CONSTANTS,
} from '../utils/constant';
import matter from 'gray-matter';
import { getBacklogTasks } from '../controller/backlogController';
import { relativePathTaskToTaskpath } from '../utils/taskUtils';

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
export function getTasksFromBacklog(backlogName: string): TreeItemLike[] {
  try {
    const tasks = getBacklogTasks(backlogName);

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

export async function removeTaskFromBacklog(backlogPath: string, taskPath: string): Promise<void> {
  const backlogFile = matter(fs.readFileSync(backlogPath, 'utf8'));
  const relativeTaskPath = path.relative(path.dirname(backlogPath), taskPath).replace(/\\/g, '/');
  
  // Remove from markdown content
  const taskPattern = new RegExp(`^.*\\[.*?\\]\\(${relativeTaskPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\).*$`, 'gm');
  let content = backlogFile.content.replace(taskPattern, '').replace(/\n\n\n+/g, '\n\n');
  
  // Remove from YAML frontmatter
  const taskId = path.basename(taskPath);
  if (backlogFile.data.tasks) {
    backlogFile.data.tasks = backlogFile.data.tasks.filter((t: any) => t._id !== taskId);
  }

  // Write updated content
  const updatedContent = matter.stringify(content, backlogFile.data);
  fs.writeFileSync(backlogPath, updatedContent);
}




// Helper: remove git conflict blocks like <<<<<<< ... ======= ... >>>>>>>
function stripMergeMarkers(content: string): string {
  return content.replace(/<<<<<<<[\s\S]*?>>>>>>>\s*.*/g, '')
                .replace(/={7,}[\s\S]*?={7,}\n?/g, '');
}
// Helper: extract YAML frontmatter block (between first pair of ---)
function extractFrontmatter(content: string): string | null {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/m);
  return m ? m[1] : null;
}
export function parseBacklogFile(filePath: string): { title: string; tasks: { label: string; abs?: string; rel?: string }[] } {
  let content = fileService.readFileSyncSafe(filePath);
  content = stripMergeMarkers(content);

  // Title
  let titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');

  const tasks: { label: string; abs?: string; rel?: string }[] = [];
  const seen = new Set<string>();

  const fm = extractFrontmatter(content);
  if (fm && /\btasks\s*:/i.test(fm)) {
    const fileRegex = /file:\s*([^\n\r]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = fileRegex.exec(fm)) !== null) {
      const rel = m[1].trim().replace(/['"]+/g, '');
      const abs = path.resolve(path.dirname(filePath), rel);
      // Build label from task YAML frontmatter when possible
      let prettyLabel = path.basename(rel);
      let computedLabel = prettyLabel;
      if (fileService.fileExists(abs) && fs.existsSync(abs)) {
        try {
          const tm = matter(fs.readFileSync(abs, 'utf8'));
          const status = (tm.data.status || 'not-started') as string;
          const priority = (tm.data.priority || '') as string;
          const statusKey = status.toUpperCase().replace(/-/g, '_') as keyof typeof UI_CONSTANTS.EMOJI.STATUS;
          const statusEmoji = UI_CONSTANTS.EMOJI.STATUS[statusKey] || UI_CONSTANTS.EMOJI.STATUS.WAITING;
          const priorityKey = (priority || '').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
          const priorityEmoji = priority ? (UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || '') : '';
          computedLabel = `${statusEmoji} ${path.basename(abs)}${priorityEmoji ? ' ' + priorityEmoji : ''}`;
        } catch {
          // fallback to basename if parsing fails
          computedLabel = path.basename(rel);
        }
      } else {
        // Task file missing — show default status emoji + basename
        const statusEmoji = UI_CONSTANTS.EMOJI.STATUS.WAITING;
        computedLabel = `${statusEmoji} ${path.basename(rel)}`;
      }
      const key = `${prettyLabel}|${abs}`;
      if (!seen.has(key)) {
        seen.add(key);
        tasks.push({ label: computedLabel, abs: fileService.fileExists(abs) ? abs : undefined, rel });
      }
    }
    if (tasks.length) return { title, tasks };
  }

  // Fallback to Markdown '## Tasks' parsing
  const sectionMatch = content.match(/(^|\r?\n)##\s*Tasks\b[^\n]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s+\S|\s*$)/i);
  if (!sectionMatch) return { title, tasks };
  const section = sectionMatch[2] ?? '';

  const rawItems: string[] = [];
  const ulRegex = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
  let mm: RegExpExecArray | null;
  while ((mm = ulRegex.exec(section)) !== null) {
    rawItems.push(mm[1].trim());
  }
  const olRegex = /^\s*\d+[\.)]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
  while ((mm = olRegex.exec(section)) !== null) {
    rawItems.push(mm[1].trim());
  }

  for (const itemText of rawItems) {
    const linkMatch = itemText.match(/\[([^\]]+)\]\(([^)]+)\)/);
    let labelSlug = linkMatch ? linkMatch[1] : itemText.replace(/^📌\s*/, '').trim();
    const prettyLabel = labelSlug.replace(/[_-]+/g, ' ').trim();
    let key = prettyLabel;
    if (linkMatch) {
      const rel = linkMatch[2];
      const abs = path.resolve(path.dirname(filePath), rel);
      key = `${prettyLabel}|${abs}`;
      if (!seen.has(key)) {
        seen.add(key);
        // compute label from YAML if possible
        let computedLabel = prettyLabel;
        if (fileService.fileExists(abs) && fs.existsSync(abs)) {
          try {
            const tm = matter(fs.readFileSync(abs, 'utf8'));
            const status = (tm.data.status || 'not-started') as string;
            const priority = (tm.data.priority || '') as string;
            const statusKey = status.toUpperCase().replace(/-/g, '_') as keyof typeof UI_CONSTANTS.EMOJI.STATUS;
            const statusEmoji = UI_CONSTANTS.EMOJI.STATUS[statusKey] || UI_CONSTANTS.EMOJI.STATUS.WAITING;
            const priorityKey = (priority || '').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
            const priorityEmoji = priority ? (UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || '') : '';
            computedLabel = `${statusEmoji} ${path.basename(abs)}${priorityEmoji ? ' ' + priorityEmoji : ''}`;
          } catch {
            computedLabel = path.basename(rel);
          }
        } else {
          computedLabel = `${UI_CONSTANTS.EMOJI.STATUS.WAITING} ${path.basename(rel)}`;
        }
        tasks.push({ label: computedLabel, abs: fileService.fileExists(abs) ? abs : undefined, rel });
      }
    } else {
      if (!seen.has(key)) {
        seen.add(key);
        // no linked file — show default status and the pretty label
        tasks.push({ label: `${UI_CONSTANTS.EMOJI.STATUS.WAITING} ${prettyLabel}` });
      }
    }
  }

  return { title, tasks };
}
export function listBacklogsSummary(ws: string): { filePath: string; title: string; tasks: { label: string; abs?: string }[] }[] {
  const files = listBacklogs(ws);
  return files.map(f => {
    const parsed = parseBacklogFile(f);
    return { filePath: f, title: parsed.title, tasks: parsed.tasks };
  });
}
export function listBacklogs(ws: string): string[] {
  const backlogsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR);

  console.log('returned fileservice: ', fileService.listMdFiles(backlogsDir));
  return fileService.listMdFiles(backlogsDir).map(f => path.join(backlogsDir, f));
}
export function readBacklog(filePath: string): string {
  return fileService.readFileSyncSafe(filePath);
}
export function updateBacklog(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}
export function deleteBacklog(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
export async function addExistingTasksToBacklog(item: any) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found.'); return; }

  const taskDirs = fileService.getExistingTasksDirs(ws);
  const fileEntries: { dir: string; file: string }[] = [];
  for (const d of taskDirs) {
    const entries = fileService.listMdFiles(d);
    for (const f of entries) fileEntries.push({ dir: d, file: f });
  }
  if (!fileEntries.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = fileEntries.map(({dir, file}) => {
    const titleMatch = file.match(new RegExp(`^${PROJECT_CONSTANTS.FILE_PREFIX.TASK}(.+?)(?:_${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}.+)?${PROJECT_CONSTANTS.MD_FILE_EXTENSION}$`, 'i'));
    const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : file.replace(new RegExp(PROJECT_CONSTANTS.MD_FILE_EXTENSION + '$', 'i'), '');
    return {
      label: title,
      description: dir,
      detail: file,
      // Save original data for use later
      data: { dir, file }
    } as vscode.QuickPickItem & { data: { dir: string, file: string }};
  });

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Backlog' });
  if (!picked || picked.length === 0) return;

  try {
    let content = fs.readFileSync(backlogFile, 'utf8');
    for (const p of picked) {
      const linkTitle = p.label.trim().replace(/\s+/g, '-').toLowerCase();
      const tasksFolder = path.basename((p as any).data.dir || path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR));
      const link = `- ${TASK_CONSTANTS.LINK_MARKER} [${linkTitle}](../${tasksFolder}/${(p as any).data.file}) ${TASK_CONSTANTS.STATUS.WAITING}`;
      content = insertTaskLinkUnderSection(content, UI_CONSTANTS.SECTIONS.TASKS, link);
    }
    fs.writeFileSync(backlogFile, content, 'utf8');
    vscode.window.showInformationMessage('Tasks added to backlog.');
  } catch {
    vscode.window.showErrorMessage('Failed to update backlog file.');
  }
}
export async function addTaskToBacklogInteractive(item: any) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found for this item.'); return; }
  const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
  if (!taskName) return;
  const epicName = await vscode.window.showInputBox({ prompt: 'Epic name (optional)' });

  const tasksDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
  const epicsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(epicsDir, { recursive: true });

  let fileName = `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${taskName.replace(/\s+/g, '-')}`;
  if (epicName) fileName += `_${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epicName.replace(/\s+/g, '-')}`;
  fileName += PROJECT_CONSTANTS.MD_FILE_EXTENSION;

  const taskPath = path.join(tasksDir, fileName);
  if (!fs.existsSync(taskPath)) {
    const template = `---\n_id: ${PROJECT_CONSTANTS.ID_PREFIX.TASK}${taskName.replace(/\s+/g, '-').toLowerCase()}\nname: ${taskName.replace(/\s+/g, '-').toLowerCase()}\n---\n\n# 🧩 Task: ${taskName}\n`;
    fs.writeFileSync(taskPath, template, 'utf8');
  }

  if (epicName) {
    const epicFile = path.join(epicsDir, `${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epicName.replace(/\s+/g, '-')}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`);
    let epicContent = fileService.readFileSyncSafe(epicFile) || `# Epic: ${epicName}\n`;
      const taskLink = `- ${TASK_CONSTANTS.LINK_MARKER} [${taskName.replace(/\s+/g, '-').toLowerCase()}](../${PROJECT_CONSTANTS.TASKS_DIR}/${fileName})`;
    epicContent = insertTaskLinkUnderSection(epicContent, UI_CONSTANTS.SECTIONS.TASKS.toLowerCase(), taskLink);
    fs.writeFileSync(epicFile, epicContent, 'utf8');
  }

  try {
    let backlogContent = fs.readFileSync(backlogFile, 'utf8');
    const taskLink = `- ${TASK_CONSTANTS.LINK_MARKER} [${taskName.replace(/\s+/g, '-').toLowerCase()}](../${PROJECT_CONSTANTS.TASKS_DIR}/${fileName})`;
    backlogContent = insertTaskLinkUnderSection(backlogContent, UI_CONSTANTS.SECTIONS.TASKS, taskLink);
    fs.writeFileSync(backlogFile, backlogContent, 'utf8');
    vscode.window.showInformationMessage('Task added to backlog.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to update backlog file.');
  }
}