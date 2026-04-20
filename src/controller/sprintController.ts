import * as fs from 'fs';
import * as path from 'path';
import { getSprintsPath } from '../utils/backlogUtils';
import { UI_CONSTANTS } from '../utils/constant';
import { getDataService } from '../data/DataService';
import * as fileService from '../services/fileService';

interface ITask {
  _id: string;
  name: string;
  status: string;
  priority: string;
  path: string;
}

export function getSprints(): string[] {
  const sprintsPath = getSprintsPath();
  if (!fs.existsSync(sprintsPath)) return [];

  const files = fs.readdirSync(sprintsPath);
  // filter only .md files and return basename without extension
  const sprintNames = files
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));

  return sprintNames;
}

export function getSprintPath(sprintName: string): string {
  const sprintsPath = getSprintsPath();
  return path.join(sprintsPath, `${sprintName}`);
}

export function getSprintMetadata(sprintName: string): { [key: string]: any; } {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintName);
  return sprint || {};
}

export function getSprintContent(sprintFile: string): { [key: string]: any; } {
  try {
    const matter = require('gray-matter');
    const parsed = matter.read(sprintFile);
    return parsed?.data || {};
  } catch (e) {
    return {};
  }
}

export function getSprintDescription(sprintName: string): string {
  const { description } = getSprintMetadata(sprintName);
  return description;
}

export function getSprintTasks(sprintName: string): ITask[] {
  const { tasks } = getSprintMetadata(sprintName);
  return tasks;
}

export function getSprintTotalTasks(sprintName: string): number {
  const tasks = getSprintTasks(sprintName);
  return tasks ? tasks.length : 0;
}

/* Tasks Operations */
export function addTaskToSprint(sprintPath: string, taskPath: string): void {
  try {
    const ws = fileService.getWorkspaceRoot();
    const dataService = getDataService(ws);
    const sprintId = path.basename(String(sprintPath), path.extname(String(sprintPath)));
    const taskId = path.basename(String(taskPath), path.extname(String(taskPath)));

    const sprint = dataService.getSprint(sprintId);
    if (!sprint) {
      console.warn('Sprint not found in data store:', sprintId);
      return;
    }

    // ensure task exists in data; if not, try to read frontmatter for metadata
    let taskObj = dataService.getTask(taskId);
    if (!taskObj && fs.existsSync(taskPath)) {
      const matter = require('gray-matter');
      const tm = matter.read(taskPath);
      const tid = tm.data?._id || tm.data?.id || taskId;
      taskObj = dataService.getTask(tid) || { id: tid, title: tm.data?.title || path.basename(taskPath) } as any;
    }

    if (sprint.tasks && sprint.tasks.includes(taskObj?.id)) {
      console.log(`Task with ID ${taskObj?.id} already exists in sprint.`);
      return;
    }

    // add task id to sprint and persist via DataService
    sprint.tasks = sprint.tasks || [];
    sprint.tasks.push(taskObj?.id);
    dataService.updateSprint(String(sprint.id), { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);

    // update task.sprint and persist
    if (taskObj && taskObj.id) {
      dataService.updateTask(String(taskObj.id), { sprint: String(sprint.id) });
      dataService.saveTaskMd(taskObj as any);
    }
  } catch (e) {
    console.error('Failed to add task to sprint via DataService', e);
  }

}

export function removeTaskFromSprint(sprintPath: string, taskPath: string): void {
  try {
    const ws = fileService.getWorkspaceRoot();
    const dataService = getDataService(ws);
    const sprintId = path.basename(String(sprintPath), path.extname(String(sprintPath)));
    const taskId = path.basename(String(taskPath), path.extname(String(taskPath)));

    const sprint = dataService.getSprint(sprintId);
    if (!sprint) {
      console.warn('Sprint not found in data store:', sprintId);
      return;
    }

    const tasks = (sprint.tasks || []).filter((t: string) => t !== taskId);
    if (tasks.length === (sprint.tasks || []).length) {
      console.log(`Task with ID ${taskId} not found in sprint.`);
      return;
    }

    sprint.tasks = tasks;
    dataService.updateSprint(String(sprint.id), { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);

    const taskObj = dataService.getTask(taskId);
    if (taskObj) {
      dataService.updateTask(String(taskObj.id), { sprint: '' });
      dataService.saveTaskMd(taskObj as any);
    }
  } catch (e) {
    console.error('Failed to remove task from sprint via DataService', e);
  }
}
