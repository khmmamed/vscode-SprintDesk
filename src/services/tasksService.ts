import * as taskService from './taskService';
import * as epicService from './epicService';
import * as backlogService from './backlogService';
import * as sprintService from './sprintService';

// Backwards-compatible façade: re-export previously-used functions
export const createTaskAndLink = taskService.createTaskInteractive;
export const addExistingTasksToSprint = sprintService.addExistingTasksToSprint;
export const addTaskToBacklog = backlogService.addTaskToBacklogInteractive;
export const addExistingTasksToBacklog = backlogService.addExistingTasksToBacklog;
export const addEpic = epicService.createEpicInteractive;
export const addSprint = sprintService.createSprintInteractive;
export const startFeatureFromTask = sprintService.startFeatureFromTask;
