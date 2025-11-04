import * as vscode from 'vscode';
import * as path from 'path';
import * as taskService from '../services/taskService';
import { PROJECT_CONSTANTS } from './constant';


export const getTasksPath = (): string => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const workspaceRoot = wsFolders[0].uri.fsPath;
const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.TASKS_DIR);
};
export const getTaskPath = (taskName: string): string => {
    const tasksPath = getTasksPath();
    return path.join(tasksPath, `${taskName}`);
}
export const relativePathTaskToTaskpath = (rel: string): string => {
    const ws = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const ProjectDir = path.join(ws!, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
    return path.resolve(ProjectDir, rel);
};
export const removeEmojiFromTaskLabel = (label: string): string => {
    return label.replace(/\p{Extended_Pictographic}/gu, '').trim();
}
export interface TaskRow {
    task: string;
    epic: string;
    file: string;
}

export function parseTaskFile(filePath: string): TaskRow | null {
    try {
        const base = path.basename(filePath);
        const match = base.match(/^\[Task\]_(.+)_\[Epic\]_(.+)\.md$/i);
        if (match) {
            return {
                task: "🚀 " + match[1].replace(/[-_]+/g, " "),
                epic: "🚩 " + match[2].replace(/[-_]+/g, " "),
                file: base,
            };
        } else {
            // fallback: accept [Task]_title.md
            const m2 = base.match(/^\[Task\]_(.+?)\.md$/i);
            if (m2) {
                return {
                    task: "🚀 " + m2[1].replace(/[-_]+/g, " "),
                    epic: "",
                    file: base
                };
            }
        }
    } catch (e) {
        console.error('Error parsing task file:', e);
    }
    return null;
}

export function getAllTaskRows(rootPath: string): TaskRow[] {
    const taskRows: TaskRow[] = [];
    const mdFiles = taskService.readTasks(rootPath);

    for (const file of mdFiles) {
        const taskRow = parseTaskFile(file);
        if (taskRow) {
            taskRows.push(taskRow);
        }
    }

    return taskRows;
}