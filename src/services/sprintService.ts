import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import insertTaskLinkUnderSection from '../utils/mdUtils';
import { PROJECT_CONSTANTS, SPRINT_CONSTANTS, UI_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import { getSprintTasks } from '../controller/sprintController';
import { relativePathTaskToTaskpath } from '../utils/taskUtils';
import { SprintDeskItem } from '../utils/SprintDeskItem';
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
export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string }): string {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) throw new Error('No workspace');
  const { d1, mo1, d2, mo2, yy, yyyy } = nameParts;
  const fileName = `${PROJECT_CONSTANTS.FILE_PREFIX.SPRINT}${d1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo1}${SPRINT_CONSTANTS.SEPARATOR.DURATION}${d2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo2}${SPRINT_CONSTANTS.SEPARATOR.DURATION}${yyyy}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`;
  const sprintsDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.SPRINTS_DIR);
  fs.mkdirSync(sprintsDir, { recursive: true });
  const filePath = path.join(sprintsDir, fileName);
  
  if (!fs.existsSync(filePath)) {
    const shortStart = `${d1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo1}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;
    const shortEnd = `${d2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${mo2}${SPRINT_CONSTANTS.SEPARATOR.DATE}${yy}`;
    const content = `# ${UI_CONSTANTS.EMOJI.COMMON.CALENDAR} Sprint : ${shortStart} ➜ ${shortEnd}\n- **${UI_CONSTANTS.EMOJI.COMMON.LAST_UPDATE} Last update:** ${new Date().toISOString()}\n- **${UI_CONSTANTS.EMOJI.COMMON.TOTAL_TASKS} Total Tasks:** 0\n- **${UI_CONSTANTS.EMOJI.COMMON.PROGRESS} Progress:** ✅ [0/0] 🟩100%\n- **${UI_CONSTANTS.EMOJI.COMMON.SUMMARY} Summary:** \n\n## ${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} Tasks\n`;
    
    // Use SprintDeskItem class to create sprint
    try {
      const sprintItem = new SprintDeskItem(filePath);
      
      // Create sprint file using SprintDeskItem
      sprintItem.update(content, {
        title: `Sprint : ${shortStart} ➜ ${shortEnd}`,
        startDate: `${d1}${mo1}${yyyy}`,
        endDate: `${d2}${mo2}${yyyy}`,
        totalTasks: 0,
        completedTasks: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      sprintItem.create();
      
      console.log(`✅ Sprint created successfully using SprintDeskItem: ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to create sprint with SprintDeskItem, falling back to original method:', error);
      
      // Fallback to original method if SprintDeskItem fails
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
  return filePath;
}

export async function createSprintInteractive() {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter sprint as: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy',
    placeHolder: '@sprint 11-08_16-08_25'
  });
  if (!input) return;
  const m = input.match(/@sprint\s+(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{2}|\d{4})\b/i);
  if (!m) { vscode.window.showErrorMessage('Format must be: @sprint dd-mm_dd-mm_yy or dd-mm_dd-mm_yyyy'); return; }
  const d1 = m[1], mo1 = m[2], d2 = m[3], mo2 = m[4];
  let yy = m[5];
  const yyyy = yy.length === 2 ? `${SPRINT_CONSTANTS.SEPARATOR.YEAR_PREFIX}${yy}` : yy;
  if (yy.length === 4) yy = yy.slice(-2);
  createSprint({ d1, mo1, d2, mo2, yy, yyyy });
  vscode.window.showInformationMessage('Sprint created.');
}

export async function addExistingTasksToSprint(item: any) {
  const ws = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
  const sprintFile: string | undefined = item?.filePath;
  if (!sprintFile) { vscode.window.showErrorMessage('Sprint file not found.'); return; }

  const taskDirs = fileService.getExistingTasksDirs(ws);
  const fileEntries: { dir: string; file: string }[] = [];
  for (const d of taskDirs) {
    const entries = fileService.listMdFiles(d);
    for (const f of entries) fileEntries.push({ dir: d, file: f });
  }
  if (!fileEntries.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = fileEntries.map(({dir, file}) => {
  const titleMatch = file.match(new RegExp(`^${PROJECT_CONSTANTS.FILE_PREFIX.TASK}(.+?)(?:_${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}.+)?${PROJECT_CONSTANTS.MD_FILE_EXTENSION}$`, 'i'));
  const title = titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : file.replace(new RegExp(`${PROJECT_CONSTANTS.MD_FILE_EXTENSION}$`, 'i'), '');
    return { label: title, file, dir } as { label: string, file: string, dir: string };
  });

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
  if (!picked || picked.length === 0) return;

  try {
    let sprintContent = fs.readFileSync(sprintFile, 'utf8');
    for (const p of picked) {
      const linkTitle = p.label.trim().replace(/\s+/g, '-').toLowerCase();
  const tasksFolder = path.basename((p as any).dir || path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR));
  const link = `- ${TASK_CONSTANTS.LINK_MARKER} [${linkTitle}](../${tasksFolder}/${p.file}) ${TASK_CONSTANTS.STATUS.WAITING}`;
  sprintContent = insertTaskLinkUnderSection(sprintContent, UI_CONSTANTS.SECTIONS.TASKS, link);
    }
    fs.writeFileSync(sprintFile, sprintContent, 'utf8');
    vscode.window.showInformationMessage('Tasks added to sprint.');
  } catch {
    vscode.window.showErrorMessage('Failed to update sprint file.');
  }
}

export async function startFeatureFromTask(item: any) {
  try {
    const workspaceRoot = fileService.getWorkspaceRoot() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const taskSlug: string | undefined = item?.taskSlug || item?.label?.toString()?.replace(/\s+/g, '-');
    const taskFilePath: string | undefined = item?.taskFilePath;
    const sprintFilePath: string | undefined = item?.sprintFilePath;
    if (!taskSlug) { vscode.window.showErrorMessage('Unable to infer task name.'); return; }

    const terminal = vscode.window.createTerminal({ name: 'SprintDesk: git flow' });
    terminal.show(true);
    terminal.sendText(`cd "${workspaceRoot}"`);
    terminal.sendText(`git flow feature start ${taskSlug}`);

    const dateStr = new Date().toISOString();

    if (taskFilePath) {
      const uri = vscode.Uri.file(taskFilePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      let updated = text;
      const statusRegex = /(\n- \*\*📍 Status:\*\*.*\n)([\s\S]*)/;
      if (statusRegex.test(text)) {
        updated = text.replace(statusRegex, (_m, head, tail) => `${head}\n- **🟢 Started:** ${dateStr}\n${tail}`);
      } else {
        updated = `${text}\n\n- **🟢 Started:** ${dateStr}\n`;
      }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    }

    if (sprintFilePath && item?.taskSlug) {
      const sUri = vscode.Uri.file(sprintFilePath);
      const sBytes = await vscode.workspace.fs.readFile(sUri);
      let sprintText = Buffer.from(sBytes).toString('utf8');
      const linkTitle = item.taskSlug.replace(/\s+/g, '-').toLowerCase();
      const link = `- 📌 [${linkTitle}](../tasks/${item?.taskFileName || item?.taskFilePath?.split('\\').pop()}) ✅ [in progress]`;
      sprintText = insertTaskLinkUnderSection(sprintText, 'Tasks', link);
      await vscode.workspace.fs.writeFile(sUri, new TextEncoder().encode(sprintText));
    }
  } catch (e) {
    vscode.window.showErrorMessage('Failed to start feature from task.');
  }
}

export function getTasksFromSprint(sprintName: string): TreeItemLike[] {
  try {
    const tasks = getSprintTasks(sprintName);
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
