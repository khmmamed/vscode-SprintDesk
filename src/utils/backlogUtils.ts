import path from "path";
import { PROJECT_CONSTANTS } from "./constant"
import * as fileService from '../services/fileService';

export const getBacklogsPath = (): string => {
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new Error("No workspace folder is open.");
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.BACKLOGS_DIR);
};
export const getBacklogPath = (backlogName: string): string => {
    const backlogsPath = getBacklogsPath();
    return path.join(backlogsPath, `${backlogName}`);
}
export const getEpicsPath = (): string => {
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new Error("No workspace folder is open.");
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.EPICS_DIR);
};
export const getEpicPath = (epicName: string): string => {
    const epicsPath = getEpicsPath();
    return path.join(epicsPath, `${epicName}`);
}
export const getSprintsPath = (): string => {
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new Error("No workspace folder is open.");
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.SPRINTS_DIR);
};
export const getTasksPath = (): string => {
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new Error("No workspace folder is open.");
    const SPRINTDESK_PATH = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR);
    return path.join(SPRINTDESK_PATH, PROJECT_CONSTANTS.TASKS_DIR);
};