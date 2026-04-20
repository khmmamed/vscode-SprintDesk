import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as fileService from './fileService';
import { getDataService } from '../data/DataService';
import { Task, TasksData, Config } from '../data/types';

const SPRINTDESK_DIR = '.SprintDesk';
const DATA_DIR = 'data';

class TaskService {
  private workspaceRoot: string;
  private configCache: Config | null = null;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || this.getDefaultWorkspaceRoot();
  }

  private getDefaultWorkspaceRoot(): string {
    const ws = vscode.workspace.workspaceFolders;
    return ws?.[0]?.uri.fsPath || '';
  }

  private getSprintDeskPath(): string {
    return path.join(this.workspaceRoot, SPRINTDESK_DIR);
  }

  private getDataPath(): string {
    return path.join(this.getSprintDeskPath(), DATA_DIR);
  }

  private getTasksDir(): string {
    const config = this.loadConfig();
    return path.join(this.getSprintDeskPath(), config.directories.tasks);
  }

  private loadConfig(): Config {
    if (this.configCache) {
      return this.configCache;
    }

    const cfg = vscode.workspace.getConfiguration('sprintdesk');
    const taskPrefix = cfg.get<string>('taskPrefix') || 'task_';
    const taskStart = cfg.get<number>('taskStartNumber') || 100;
    const taskPad = cfg.get<number>('taskPadding') || 3;
    const epicPrefix = cfg.get<string>('epicPrefix') || 'epic_';
    const sprintPrefix = cfg.get<string>('sprintPrefix') || 'sprint_';
    const defaultBacklog = cfg.get<string>('defaultBacklog') || 'features';
    const defaultStatus = cfg.get<string>('defaultStatus') || 'waiting';
    const defaultPriority = cfg.get<string>('defaultPriority') || 'medium';
    const showIds = cfg.get<boolean>('showIds') ?? true;
    const showCompleted = cfg.get<boolean>('showCompleted') ?? false;

    this.configCache = {
      ids: {
        task: { prefix: taskPrefix, startNumber: taskStart, padding: taskPad },
        epic: { prefix: epicPrefix, startNumber: 1, padding: 2 },
        sprint: { prefix: sprintPrefix, startNumber: 1, padding: 1 },
        backlog: { prefix: '' }
      },
      defaults: {
        backlog: defaultBacklog,
        epic: null,
        sprint: null,
        status: defaultStatus,
        priority: defaultPriority,
        type: 'feature'
      },
      ui: {
        showCompleted,
        defaultView: 'tree',
        showIds,
        dateFormat: 'iso'
      },
      directories: {
        data: 'data',
        tasks: 'Tasks',
        backlogs: 'Backlogs',
        epics: 'Epics',
        sprints: 'Sprints',
        templates: 'templates'
      }
    };

    return this.configCache;
  }

  private getMdFilenamePattern(): string {
    const cfg = vscode.workspace.getConfiguration('sprintdesk');
    return cfg.get<string>('taskNamePattern') || '[task-${taskNumber}]_${tasktitle}.md';
  }

  private generateHexId(): string {
    return crypto.randomUUID().split('-')[0];
  }

  private generateTaskCode(): string {
    const config = this.loadConfig();
    const tasks = this.loadTasks();
    const idConfig = config.ids.task;
    let maxNum = idConfig.startNumber - 1;

    tasks.forEach(t => {
      if (t.code) {
        const num = parseInt(t.code.replace(/\D/g, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });

    const nextNum = maxNum + 1;
    const padding = idConfig.padding;
    return `task-${nextNum.toString().padStart(padding, '0')}`;
  }

  private slugifyTitle(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  private getTaskMdFilename(task: Task): string {
    const pattern = this.getMdFilenamePattern();
    // Clean task number for filename: remove leading "task-" or "task_" if present
    let taskNumber = (task.code || '').replace(/^task[-_]?/i, '');
    const tasktitle = this.slugifyTitle(task.title);

    return pattern
      .replace(/\$\{tasknumber\}/ig, taskNumber)
      .replace(/\$\{tasktitle\}/ig, tasktitle);
  }

  private getTaskMdPath(task: Task): string {
    const tasksDir = this.getTasksDir();
    return path.join(tasksDir, this.getTaskMdFilename(task));
  }

  private generateTaskMd(task: Task, additionalContent?: string): string {
    const frontmatter = {
      _id: task.id,
      code: task.code,
      title: task.title,
      type: task.type,
      status: task.status,
      priority: task.priority,
      epic: task.epic,
      backlog: task.backlog,
      sprint: task.sprint,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };

    let md = '---\n';
    md += yaml.dump(frontmatter).replace(/^---\n/, '').replace(/\n$/, '');
    md += '\n---\n\n';

    md += `# 🧩 Task: ${task.title}\n\n`;

    if (additionalContent) {
      md += additionalContent;
    } else {
      md += `## 📋 Description\n\n`;
      md += `## ✅ Acceptance Criteria\n\n`;
    }

    return md;
  }

  private saveTaskMd(task: Task, preserveUserContent: boolean = true): void {
    const tasksDir = this.getTasksDir();
    fs.mkdirSync(tasksDir, { recursive: true });

    const newFilePath = this.getTaskMdPath(task);
    let additionalContent: string | undefined;

    if (preserveUserContent) {
      const oldFilePath = path.join(tasksDir, `${task.id}.md`);
      if (fs.existsSync(oldFilePath)) {
        const existingContent = fs.readFileSync(oldFilePath, 'utf8');
        const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
        if (userContentMatch) {
          additionalContent = userContentMatch[1];
        }
      }
    }

    const md = this.generateTaskMd(task, additionalContent);
    try {
      fs.writeFileSync(newFilePath, md, 'utf8');
      console.log('[SprintDesk] Saved task markdown:', newFilePath);
    } catch (e) {
      console.error('[SprintDesk] Failed to save task markdown:', newFilePath, e);
    }
  }

  private deleteTaskMd(task: Task): void {
    const tasksDir = this.getTasksDir();
    
    const oldFilePath = path.join(tasksDir, `${task.id}.md`);
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    const newFilePath = this.getTaskMdPath(task);
    if (fs.existsSync(newFilePath) && newFilePath !== oldFilePath) {
      fs.unlinkSync(newFilePath);
    }
  }

  // === YAML Operations ===
  private loadTasksFromYaml(): Task[] {
    const dataService = getDataService(this.workspaceRoot);
    return dataService.loadTasks();
  }

  private saveTasksToYaml(tasks: Task[]): void {
    const dataService = getDataService(this.workspaceRoot);
    dataService.saveTasks(tasks);
  }

  // === Public CRUD Methods ===

  loadTasks(): Task[] {
    return this.loadTasksFromYaml();
  }

  getTask(taskId: string): Task | undefined {
    const tasks = this.loadTasksFromYaml();
    return tasks.find(t => t.id === taskId);
  }

  createTask(ws: string, taskData: {
    title: string;
    type?: string;
    status?: string;
    priority?: string;
    backlog?: string;
    epic?: string | null;
  }): Task {
    if (!ws) {
      ws = this.workspaceRoot || this.getDefaultWorkspaceRoot();
    }
    this.workspaceRoot = ws;

    const config = this.loadConfig();

    const task: Task = {
      id: this.generateHexId(),
      code: this.generateTaskCode(),
      title: taskData.title,
      type: (taskData.type as Task['type']) || (config.defaults.type as Task['type']) || 'feature',
      status: (taskData.status as Task['status']) || (config.defaults.status as Task['status']) || 'waiting',
      priority: (taskData.priority as Task['priority']) || (config.defaults.priority as Task['priority']) || 'medium',
      epic: taskData.epic || null,
      backlog: taskData.backlog || config.defaults.backlog || 'features',
      sprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // compute and store relative path for the task markdown file
    try {
      const filename = this.getTaskMdFilename(task);
      task.path = `../${config.directories.tasks}/${filename}`;
    } catch (e) {
      task.path = undefined;
    }

    const dataService = getDataService(ws);
    dataService.addTask(task);
    dataService.saveTaskMd(task);

    return task;
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const dataService = getDataService(this.workspaceRoot);
    dataService.updateTask(taskId, updates);
    const updated = dataService.getTask(taskId);
    if (updated) dataService.saveTaskMd(updated as any);
  }

  deleteTask(taskId: string): void {
    const dataService = getDataService(this.workspaceRoot);
    dataService.deleteTask(taskId);
    dataService.deleteTaskMd(taskId);
  }

  // Create task from existing full Task data (used by migration)
  createTaskFromData(ws: string, taskData: Task): Task {
    if (!ws) {
      ws = this.workspaceRoot || this.getDefaultWorkspaceRoot();
    }
    this.workspaceRoot = ws;

    const task: Task = { ...taskData };
    // ensure createdAt/updatedAt exist
    task.createdAt = task.createdAt || new Date().toISOString();
    task.updatedAt = task.updatedAt || new Date().toISOString();

    const dataService = getDataService(ws);
    dataService.addTask(task);
    dataService.saveTaskMd(task, true);

    return task;
  }
}

let taskServiceInstance: TaskService | null = null;

export function getTaskService(workspaceRoot?: string): TaskService {
  if (!taskServiceInstance) {
    taskServiceInstance = new TaskService(workspaceRoot);
  } else if (workspaceRoot) {
    taskServiceInstance = new TaskService(workspaceRoot);
  }
  return taskServiceInstance;
}

export function loadTasks(): Task[] {
  return getTaskService().loadTasks();
}

export function getTask(taskId: string): Task | undefined {
  return getTaskService().getTask(taskId);
}

export async function createTask(ws: string, taskData: {
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  backlog?: string;
  epic?: string | null;
}): Promise<Task> {
  return getTaskService(ws).createTask(ws, taskData);
}

export function updateTask(taskId: string, updates: Partial<Task>): void {
  getTaskService().updateTask(taskId, updates);
}

export function createTaskFromData(ws: string, taskData: Task): Task {
  return getTaskService(ws).createTaskFromData(ws, taskData);
}

export function deleteTask(taskId: string): void {
  getTaskService().deleteTask(taskId);
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
