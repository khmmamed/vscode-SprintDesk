import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import * as vscode from "vscode";

export function readFileSyncSafe(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return '';
  }
}

export function listMdFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  } catch (e) {
    return [];
  }
}

export function getExistingTasksDirs(ws: string): string[] {
  const base = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR);
  const candidates = [path.join(base, PROJECT_CONSTANTS.TASKS_DIR)];
  const found = candidates.filter(d => fs.existsSync(d));
  return found.length ? found : [path.join(base, PROJECT_CONSTANTS.TASKS_DIR)];
}

export function fileExists(filePath: string): boolean {
  try { return fs.existsSync(filePath); } catch { return false; }
}

/* [vNext_Feature]: Implement a functions to manipulate files */

// get directories functions
export function getWorkspaceRoot(uri?: vscode.Uri): string {
  // If a file or folder URI is provided (like from a sidebar click)
  if (uri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
  }

  // Fallback to first workspace folder
  const wsFolders = vscode.workspace.workspaceFolders;
  if (wsFolders && wsFolders.length > 0) {
    return wsFolders[0].uri.fsPath;
  }

  return '';
}
export function getSprintDeskDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR);
}
export function getTasksDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
}
export function getEpicsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
}
export function getSprintsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.SPRINTS_DIR);
}
export function getBacklogsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR);
}
// [COMMIT]: get files paths functions
export function getTasksFilesPath(tasksDir: string): string[] {
  if (!fs.existsSync(tasksDir)) return [];
  const files = fs.readdirSync(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(tasksDir, f));
}

export function getEpicsFilesPath(epicsDir: string): string[] {
  if (!fs.existsSync(epicsDir)) return [];
  const files = fs.readdirSync(epicsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(epicsDir, f));
}

export function getBacklogsFilesPath(backlogsDir: string): string[] {
  if (!fs.existsSync(backlogsDir)) return [];
  const files = fs.readdirSync(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(backlogsDir, f));
}
export function getSprintsFilesPath(sprintsDir: string): string[] {
  if (!fs.existsSync(sprintsDir)) return [];
  const files = fs.readdirSync(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(sprintsDir, f));
}

// [COMMIT]: get files names functions without extensions
export function getTasksBaseNames(tasksDir: string): string[] {
  if (!fs.existsSync(tasksDir)) return [];
  const files = fs.readdirSync(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}
export function getEpicsBaseNames(epicsDir: string): string[] {
  if (!fs.existsSync(epicsDir)) return [];
  const files = fs.readdirSync(epicsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}

export function getBacklogsBaseNames(backlogsDir: string): string[] {
  if (!fs.existsSync(backlogsDir)) return [];
  const files = fs.readdirSync(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}
export function getSprintsBaseNames(sprintsDir: string): string[] {
  if (!fs.existsSync(sprintsDir)) return [];
  const files = fs.readdirSync(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}

// [COMMIT]: get files names functions extensions
export function getTasksNames(tasksDir: string): string[] {
  if (!fs.existsSync(tasksDir)) return [];
  const files = fs.readdirSync(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getEpicsNames(epicsDir: string): string[] {
  if (!fs.existsSync(epicsDir)) return [];
  const files = fs.readdirSync(epicsDir);
  console.log('[getEpicsNames]: Epics files found:', files);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getBacklogsNames(backlogsDir: string): string[] {
  if (!fs.existsSync(backlogsDir)) return [];
  const files = fs.readdirSync(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getSprintsNames(sprintsDir: string): string[] {
  if (!fs.existsSync(sprintsDir)) return [];
  const files = fs.readdirSync(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}

// [COMMIT]: get file path functions
export function getTaskFilePath(tasksDir: string, fileName: string): string {
  return path.join(tasksDir, fileName);
}
export function getEpicFilePath(epicsDir: string, fileName: string): string {
  return path.join(epicsDir, fileName);
}
export function getBacklogFilePath(backlogsDir: string, fileName: string): string {
  return path.join(backlogsDir, fileName);
}
export function getSprintFilePath(sprintsDir: string, fileName: string): string {
  return path.join(sprintsDir, fileName);
}
// [COMMIT]: get file base name functions
export function getTaskBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getEpicBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getBacklogBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getSprintBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
// [COMMIT]: get file name functions
export function getTaskName(filePath: string): string {
  return path.basename(filePath);
}
export function getEpicName(filePath: string): string {
  return path.basename(filePath);
}
export function getBacklogName(filePath: string): string {
  return path.basename(filePath);
}
export function getSprintName(filePath: string): string {
  return path.basename(filePath);
}

// [COMMIT]: create files functions
export function createTaskBaseName(title: string, _id : number): string {
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.TASKPATTERN(_id)}${safeTitle || 'untitled-task'}`;
}
export function createEpicBaseName(title: string, _id : number): string {
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.EPICPATTERN(_id)}${safeTitle || 'untitled-epic'}`;
}

// [COMMIT]: create relative paths functions
export function createTaskRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.TASKS_DIR}/${basename}.md`;
}
export function createEpicRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.EPICS_DIR}/${basename}.md`;
}
export function createBacklogRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.BACKLOGS_DIR}/${basename}.md`;
}
export function createSprintRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.SPRINTS_DIR}/${basename}.md`;
}

// [COMMIT]: relative paths to absolute paths functions
export function taskRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, path.basename(relativePath));
}
export function epicRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR, path.basename(relativePath));
}
export function backlogRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR, path.basename(relativePath));
}
export function sprintRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.SPRINTS_DIR, path.basename(relativePath));
}