import path from "path";
import { PROJECT_CONSTANTS } from "./constant"
import * as vscode from "vscode";

export const getBacklogsPath = (): string => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const workspaceRoot = wsFolders[0].uri.fsPath;
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.BACKLOGS_DIR);
};
export const getBacklogPath = (backlogName: string): string => {
    const backlogsPath = getBacklogsPath();
    return path.join(backlogsPath, `${backlogName}`);
}
export const getEpicsPath = (): string => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const workspaceRoot = wsFolders[0].uri.fsPath;
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.EPICS_DIR);
};
export const getSprintsPath = (): string => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const workspaceRoot = wsFolders[0].uri.fsPath;
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.SPRINTS_DIR);
};
export const getTasksPath = (): string => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        throw new Error("No workspace folder is open.");
    }
    const workspaceRoot = wsFolders[0].uri.fsPath;
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.TASKS_DIR);
};