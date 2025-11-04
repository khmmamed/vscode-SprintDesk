import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as epicController from '../controller/epicController';
import * as backlogController from '../controller/backlogController';
import { UI_CONSTANTS, PROJECT_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import { getEpicsPath } from '../utils/backlogUtils';
import { getTaskPath } from '../utils/taskUtils';


export class EpicsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: EpicsTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceEpicPath?: string
  ) {
    super(label, collapsibleState);
    console.log('filePath:', filePath, 'taskPath:', taskPath);
    if (filePath) {
      // Setup epic item
      this.contextValue = 'epic';
      this.resourceUri = vscode.Uri.file(filePath);

      // Count tasks in epic
      try {
        const { data } = matter.read(filePath);
  const taskCount = data.tasks?.length;
  this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} ${taskCount ? taskCount : 0} tasks`;
      } catch {
  this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} 0 tasks`;
      }

      // Add epic icon and tooltip
      this.iconPath = new vscode.ThemeIcon('repo');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
  .appendMarkdown(`${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this epic*');

    } else if (taskPath) {
      // Setup task item
      this.contextValue = 'task';

      try {

        const { data: taskMetadata } = matter.read(taskPath);
        const { status, priority, type } = taskMetadata;

  const statusKey = (status || 'NOT_STARTED').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.STATUS;
  const statusEmoji = UI_CONSTANTS.EMOJI.STATUS[statusKey] || UI_CONSTANTS.EMOJI.STATUS.NOT_STARTED;

        // Determine priority emoji (if any)
  const priorityKey = (priority || '').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
  const priorityEmoji = priority ? (UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || '') : '';

        console.log('Task metadata:', taskMetadata);
        // Use the full filename with extension for the label and include priority emoji
        this.label = `${statusEmoji} ${path.basename(taskPath)}`;

        // Keep priority emoji also as description for compact view
        if (priorityEmoji) this.description = priorityEmoji;

        // Create detailed tooltip
        const tooltipMd = new vscode.MarkdownString();
        tooltipMd.supportHtml = true;
        tooltipMd
          .appendMarkdown(`**${label}**\n\n`)
          .appendMarkdown(`${statusEmoji} Status: ${status}\n`);

        if (priority) {
          const priorityKey = priority.toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
          tooltipMd.appendMarkdown(`${UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || ''} Priority: ${priority}\n`);
        }

        if (type) {
          tooltipMd.appendMarkdown(`${type.toLowerCase().includes('bug') ? '🐛' : '✨'} Type: ${type}\n`);
        }

  tooltipMd.appendMarkdown(`\n${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${taskPath}\``);
        this.tooltip = tooltipMd;

      } catch {
        // Fallback if can't read task file
        this.iconPath = new vscode.ThemeIcon('tasklist');
        this.tooltip = `Task: ${label}\nPath: ${taskPath}`;
      }
    }
  }
}

export class EpicsTreeDataProvider implements vscode.TreeDataProvider<EpicsTreeItem>, vscode.TreeDragAndDropController<EpicsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<EpicsTreeItem | undefined | void> = new vscode.EventEmitter<EpicsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<EpicsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-epics'];

  private resolveTaskPath(handleData: any): string {
    let taskFilePath: string | undefined;

    // Prefer explicit path-like fields first
    if (handleData.path) taskFilePath = handleData.path;
    else if (handleData.filePath) taskFilePath = handleData.filePath;
    else if (handleData.taskPath) taskFilePath = handleData.taskPath;

    // If legacy itemHandles exists, extract basename using split(' ')[1]
  if (!taskFilePath && handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
      const raw = String(handleData.itemHandles[0] || '');
      const parts = raw.split(' ');
      const maybeBasename = parts[1] || parts.pop() || raw;
      let base = path.basename(maybeBasename).trim();
      if (!base.toLowerCase().endsWith('.md')) base = `${base}.md`;

      const ws = this.getWorkspaceRoot();
      if (!ws) throw new Error('No workspace root found');
  taskFilePath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, base);
    }

      if (!taskFilePath) throw new Error('Could not resolve task path from drop data');
    if (!fs.existsSync(taskFilePath)) throw new Error(`Task file not found: ${taskFilePath}`);

    return taskFilePath;
  }

  constructor() {
    // Initialize workspace root
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder found');
    }
    this.workspaceRoot = folders[0].uri.fsPath;

  }

  private async handleTaskDropFromTasks(target: EpicsTreeItem, handleData: any): Promise<void> {
    let taskFilePath: string | undefined;
    let taskName: string | undefined;

    // If legacy itemHandles exists, extract basename using split(' ')[1]
    if (handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
      const raw = String(handleData.itemHandles[0] || '');
      const parts = raw.split(' ');
      taskName = parts[1] || parts.pop() || raw;
    }
    const taskPath = getTaskPath(taskName || path.basename(taskFilePath || ''));

    await this.addTaskToEpic(target.filePath!, taskPath);
  }
  private async handleTaskDropFromBacklogs(target: EpicsTreeItem, handleData: any): Promise<void> {
    // Move task from backlog to epic
    let taskFilePath: string | undefined;
    let taskName: string | undefined;
    if (handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
      const raw = String(handleData.itemHandles[0] || '');
      const parts = raw.split(' ');
      taskName = parts[1] || parts.pop() || raw;
    }
    const taskPath = getTaskPath(taskName || path.basename(taskFilePath || ''));
    const backlogPath = handleData.sourceContainer?.path || handleData.backlog?.backlogName;

    await this.addTaskToEpic(target.filePath!, taskPath);
    try {
      if (backlogPath) await backlogController.removeTaskFromBacklog(backlogPath, taskPath);
    } catch (e) {
      // ignore if can't remove from backlog
    }
  }
  private async handleTaskDropFromEpics(target: EpicsTreeItem, handleData: any): Promise<void> {
    // Move between epics
    const taskPath = this.resolveTaskPath(handleData);
    await this.addTaskToEpic(target.filePath!, taskPath);
    // remove from source epic if provided
    try {
      const sourceEpic = handleData.epic?.epicName || handleData.sourceContainer?.path;
      if (sourceEpic) await epicController.removeTaskFromEpic(sourceEpic, taskPath);
    } catch {}
  }
  private async handleTaskDropFromSprints(target: EpicsTreeItem, handleData: any): Promise<void> {
    let taskFilePath: string | undefined;
    let taskName: string | undefined;
    console.log('handleTaskDropFromSprints handleData:', handleData);
    if (handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
      const raw = String(handleData.itemHandles[0] || '');
      const parts = raw.split(' ');
      taskName = parts[1] || parts.pop() || raw;
    }
    const taskPath = getTaskPath(taskName || path.basename(taskFilePath || ''));

    await this.addTaskToEpic(target.filePath!, taskPath);
  }
  private async addTaskToEpic(epicPath: string, taskPath: string): Promise<void> {

    await epicController.addTaskToEpic(epicPath, taskPath);
    this.refresh();
    void vscode.window.showInformationMessage(`Task added to epic`);

  }
  private async getTasksFromEpicName(epicName: string): Promise<EpicsTreeItem[]> {
    const treeItemsRaw = epicController.getEpicTasks(epicName);
    return (treeItemsRaw || []).map((item: any) => {
      const label = path.basename(item.path || '');
      const treeItem = new EpicsTreeItem(
        label,
        item.collapsibleState || vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        epicName
      );
      if (item.command) {
        treeItem.command = item.command;
      }
      treeItem.tooltip = `Task: ${item.title || item.name || item.label}\nPath: ${item.path}\nEpic: ${epicName}`;
      return treeItem;
    });
  }
  // handle drag and drop
  handleDrag(source: readonly EpicsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];
        if (!taskItem.taskPath) {
          throw new Error('No task path found for drag operation');
        }

        // Create a consistent task data object
        const taskData = {
          type: 'task',
          label: taskItem.label,
          taskName: taskItem.label,
          path: taskItem.taskPath,
          epic: {
            type: 'epic',
            epicName: taskItem.sourceEpicPath || taskItem.filePath
          }
        };

        dataTransfer.set('application/vnd.code.tree.sprintdesk-epics',
          new vscode.DataTransferItem(JSON.stringify(taskData))
        );

        void vscode.window.showInformationMessage(`Dragging task: ${taskItem.label}`);
      }
    } catch (error) {
      void vscode.window.showErrorMessage('Failed to start drag: ' + (error as Error).message);
    }
  }
  async handleDrop(target: EpicsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      if (!target?.filePath || target.contextValue !== 'epic') {
        throw new Error('Invalid drop target: must be an epic');
      }

      const taskSources = {
        tasks: 'application/vnd.code.tree.sprintdesk-tasks',
        backlogs: 'application/vnd.code.tree.sprintdesk-backlogs',
        epics: 'application/vnd.code.tree.sprintdesk-epics',
        sprints: 'application/vnd.code.tree.sprintdesk-sprints'
      };

      for (const [source, mimeType] of Object.entries(taskSources)) {
        const dataItem = dataTransfer.get(mimeType);
        if (dataItem) {
          const handleData = JSON.parse(dataItem.value as string);
          switch (source) {
            case 'tasks':
              await this.handleTaskDropFromTasks(target, handleData);
              break;
            case 'backlogs':
              await this.handleTaskDropFromBacklogs(target, handleData);
              break;
            case 'epics':
              await this.handleTaskDropFromEpics(target, handleData);
              break;
            case 'sprints':
              await this.handleTaskDropFromSprints(target, handleData);
              break;
          }
          return;
        }
      }

      throw new Error('No valid task data found in drop');
    } catch (error: unknown) {
      console.error('Drop error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to move task: ${errorMessage}`);
    }
  }
  private humanizeEpicName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base
      .replace(/^\[(?:epic|e)\]_?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return cleaned || base;
  }
  // tree visualization methods
  private async getEpicsTree(workspaceRoot: string): Promise<EpicsTreeItem[]> {
  const epicsDir = path.join(workspaceRoot, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
    const files = fileService.listMdFiles(epicsDir);

    const items = files.map(name => {
      const filePath = path.join(epicsDir, name);
      const label = this.humanizeEpicName(name);
      return new EpicsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    return items;
  }
  getTreeItem(element: EpicsTreeItem): vscode.TreeItem {
    return element;
  }
  async getChildren(element?: EpicsTreeItem): Promise<EpicsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];

    if (!element) {
      return this.getEpicsTree(workspaceRoot);
    }

    if (element.filePath) {
      return this.getTasksFromEpicName(path.basename(element.filePath));
    }

    return [];
  }
  private getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
