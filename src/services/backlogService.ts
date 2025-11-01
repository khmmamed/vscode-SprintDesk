import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as fileService from './fileService';
import insertTaskLinkUnderSection from '../utils/mdUtils';
import {
  PROJECT,
  TASK,
  UI,
} from '../utils/constant';

interface TreeItemLike {
  label: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  taskPath?: string;
  command?: {
    command: string;
    title: string;
    arguments: any[];
  };
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

export function parseBacklogFile(filePath: string): { title: string; tasks: { label: string; abs?: string }[] } {
  let content = fileService.readFileSyncSafe(filePath);
  content = stripMergeMarkers(content);

  // Title
  let titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');

  const tasks: { label: string; abs?: string }[] = [];
  const seen = new Set<string>();

  const fm = extractFrontmatter(content);
  if (fm && /\btasks\s*:/i.test(fm)) {
    const fileRegex = /file:\s*([^\n\r]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = fileRegex.exec(fm)) !== null) {
      const rel = m[1].trim().replace(/['"]+/g, '');
      const abs = path.resolve(path.dirname(filePath), rel);
      const prettyLabel = path.basename(rel)
        .replace(new RegExp(`\\${PROJECT.MD_FILE_EXTENSION}$`), '')
        .replace(new RegExp(`^${PROJECT.FILE_PREFIX.TASK}?`), '')
        .replace(/[_-]+/g, ' ')
        .trim();
      const key = `${prettyLabel}|${abs}`;
      if (!seen.has(key)) {
        seen.add(key);
        tasks.push({ label: prettyLabel, abs: fileService.fileExists(abs) ? abs : undefined });
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
        tasks.push({ label: prettyLabel, abs: fileService.fileExists(abs) ? abs : undefined });
      }
    } else {
      if (!seen.has(key)) {
        seen.add(key);
        tasks.push({ label: prettyLabel });
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
  const backlogsDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.BACKLOGS_DIR);
  return fileService.listMdFiles(backlogsDir).map(f => path.join(backlogsDir, f));
}

export function readBacklog(filePath: string): string {
  return fileService.readFileSyncSafe(filePath);
}

export function createBacklog(name: string): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const backlogsDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.BACKLOGS_DIR);
  fs.mkdirSync(backlogsDir, { recursive: true });
  const backlogFile = path.join(backlogsDir, `${name.replace(/\s+/g, '-')}${PROJECT.MD_FILE_EXTENSION}`);
  if (!fs.existsSync(backlogFile)) {
    fs.writeFileSync(backlogFile, `# Backlog: ${name}\n\n${UI.SECTIONS.TASKS_MARKER}\n`, 'utf8');
  }
  return backlogFile;
}

export function updateBacklog(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteBacklog(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export async function addTaskToBacklogInteractive(item: any) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found for this item.'); return; }
  const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
  if (!taskName) return;
  const epicName = await vscode.window.showInputBox({ prompt: 'Epic name (optional)' });

  const tasksDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR);
  const epicsDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.EPICS_DIR);
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(epicsDir, { recursive: true });

  let fileName = `${PROJECT.FILE_PREFIX.TASK}${taskName.replace(/\s+/g, '-')}`;
  if (epicName) fileName += `_${PROJECT.FILE_PREFIX.EPIC}${epicName.replace(/\s+/g, '-')}`;
  fileName += PROJECT.MD_FILE_EXTENSION;

  const taskPath = path.join(tasksDir, fileName);
  if (!fs.existsSync(taskPath)) {
    const template = `---\n_id: ${PROJECT.ID_PREFIX.TASK}${taskName.replace(/\s+/g, '-').toLowerCase()}\nname: ${taskName.replace(/\s+/g, '-').toLowerCase()}\n---\n\n# 🧩 Task: ${taskName}\n`;
    fs.writeFileSync(taskPath, template, 'utf8');
  }

  if (epicName) {
    const epicFile = path.join(epicsDir, `${PROJECT.FILE_PREFIX.EPIC}${epicName.replace(/\s+/g, '-')}${PROJECT.MD_FILE_EXTENSION}`);
    let epicContent = fileService.readFileSyncSafe(epicFile) || `# Epic: ${epicName}\n`;
      const taskLink = `- ${TASK.LINK_MARKER} [${taskName.replace(/\s+/g, '-').toLowerCase()}](../${PROJECT.TASKS_DIR}/${fileName})`;
    epicContent = insertTaskLinkUnderSection(epicContent, UI.SECTIONS.TASKS.toLowerCase(), taskLink);
    fs.writeFileSync(epicFile, epicContent, 'utf8');
  }

  try {
    let backlogContent = fs.readFileSync(backlogFile, 'utf8');
    const taskLink = `- ${TASK.LINK_MARKER} [${taskName.replace(/\s+/g, '-').toLowerCase()}](../${PROJECT.TASKS_DIR}/${fileName})`;
    backlogContent = insertTaskLinkUnderSection(backlogContent, UI.SECTIONS.TASKS, taskLink);
    fs.writeFileSync(backlogFile, backlogContent, 'utf8');
    vscode.window.showInformationMessage('Task added to backlog.');
  } catch (e) {
    vscode.window.showErrorMessage('Failed to update backlog file.');
  }
}

export function getTasksFromBacklog(filePath: string): TreeItemLike[] {
  try {
    const parsed = parseBacklogFile(filePath);
    const result: TreeItemLike[] = [];
    
    for (const t of parsed.tasks) {
      const item: TreeItemLike = {
        label: t.label,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        taskPath: t.abs
      };
      
      if (t.abs) {
        item.command = {
          command: 'vscode.open',
          title: 'Open Task',
          arguments: [vscode.Uri.file(t.abs)]
        };
      }
      result.push(item);
    }
    
    return result;
  } catch {
    return [];
  }
}

export async function moveTaskBetweenBacklogs(
  taskPath: string,
  sourceBacklogPath: string,
  targetBacklogPath: string
): Promise<void> {
  try {
    // Read source and target backlog files
    const sourceContent = fs.readFileSync(sourceBacklogPath, 'utf8');
    const targetContent = fs.readFileSync(targetBacklogPath, 'utf8');
    
    // Extract task details from source
    const taskName = path.basename(taskPath, PROJECT.MD_FILE_EXTENSION)
      .replace(new RegExp(`^${PROJECT.FILE_PREFIX.TASK}`), '')
      .replace(/[_-]+/g, ' ')
      .trim();
    
    const relativePath = path.relative(
      path.dirname(targetBacklogPath),
      taskPath
    ).replace(/\\/g, '/');

    // Remove task from source backlog
    const sourceLines = sourceContent.split('\n');
    const updatedSourceLines = sourceLines.filter(line => !line.includes(taskPath.replace(/\\/g, '/')));
    fs.writeFileSync(sourceBacklogPath, updatedSourceLines.join('\n'));

    // Add task to target backlog
    const taskLink = `- ${TASK.LINK_MARKER} [${taskName}](${relativePath}) ${TASK.STATUS.WAITING}`;
    const updatedTargetContent = insertTaskLinkUnderSection(targetContent, UI.SECTIONS.TASKS, taskLink);
    fs.writeFileSync(targetBacklogPath, updatedTargetContent);

    // Update task file to reference new backlog if needed
    const taskContent = fs.readFileSync(taskPath, 'utf8');
    const sourceBacklogName = path.basename(sourceBacklogPath, PROJECT.MD_FILE_EXTENSION);
    const targetBacklogName = path.basename(targetBacklogPath, PROJECT.MD_FILE_EXTENSION);
    const updatedTaskContent = taskContent.replace(
      new RegExp(`\\[${sourceBacklogName}\\]`, 'g'),
      `[${targetBacklogName}]`
    );
    fs.writeFileSync(taskPath, updatedTaskContent);

  } catch (error: any) {
    throw new Error(`Failed to move task: ${error?.message || 'Unknown error'}`);
  }
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
    const titleMatch = file.match(new RegExp(`^${PROJECT.FILE_PREFIX.TASK}(.+?)(?:_${PROJECT.FILE_PREFIX.EPIC}.+)?${PROJECT.MD_FILE_EXTENSION}$`, 'i'));
    const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : file.replace(new RegExp(PROJECT.MD_FILE_EXTENSION + '$', 'i'), '');
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
      const tasksFolder = path.basename((p as any).data.dir || path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR));
      const link = `- ${TASK.LINK_MARKER} [${linkTitle}](../${tasksFolder}/${(p as any).data.file}) ${TASK.STATUS.WAITING}`;
      content = insertTaskLinkUnderSection(content, UI.SECTIONS.TASKS, link);
    }
    fs.writeFileSync(backlogFile, content, 'utf8');
    vscode.window.showInformationMessage('Tasks added to backlog.');
  } catch {
    vscode.window.showErrorMessage('Failed to update backlog file.');
  }
}
