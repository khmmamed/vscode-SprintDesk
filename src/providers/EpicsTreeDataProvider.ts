import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';
import { PROJECT, UI } from '../utils/constant';
import * as fileService from '../services/fileService';

export class EpicTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: EpicTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceEpicPath?: string

  ) {
    super(label, collapsibleState);

    if (filePath) {
      // Setup epic item
      this.contextValue = 'epic';
      this.resourceUri = vscode.Uri.file(filePath);

      // Count tasks in epic
      try {
        const { data } = matter.read(filePath);
        const taskCount = data.tasks?.length;
        this.description = `${UI.EMOJI.COMMON.TASK_LIST} ${taskCount ? taskCount : 0} tasks`;
      } catch {
        this.description = `${UI.EMOJI.COMMON.TASK_LIST} 0 tasks`;
      }

      // Add backlog icon and tooltip
      this.iconPath = new vscode.ThemeIcon('repo');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
        .appendMarkdown(`${UI.EMOJI.COMMON.FILE} Path: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this backlog*');

    } else if (taskPath) {
      // Setup task item
      this.contextValue = 'task';

      try {

        const { data: taskMetadata } = matter.read(taskPath);
        const { status, priority, type } = taskMetadata;

        const statusKey = (status || 'NOT_STARTED').toUpperCase() as keyof typeof UI.EMOJI.STATUS;
        const statusEmoji = UI.EMOJI.STATUS[statusKey] || UI.EMOJI.STATUS.NOT_STARTED;

        // Determine priority emoji (if any)
        const priorityKey = (priority || '').toUpperCase() as keyof typeof UI.EMOJI.PRIORITY;
        const priorityEmoji = priority ? (UI.EMOJI.PRIORITY[priorityKey] || '') : '';

        console.log('this.label before:', this.label);
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
          const priorityKey = priority.toUpperCase() as keyof typeof UI.EMOJI.PRIORITY;
          tooltipMd.appendMarkdown(`${UI.EMOJI.PRIORITY[priorityKey] || ''} Priority: ${priority}\n`);
        }

        if (type) {
          tooltipMd.appendMarkdown(`${type.toLowerCase().includes('bug') ? '🐛' : '✨'} Type: ${type}\n`);
        }

        tooltipMd.appendMarkdown(`\n${UI.EMOJI.COMMON.FILE} Path: \`${taskPath}\``);
        this.tooltip = tooltipMd;

      } catch {
        // Fallback if can't read task file
        this.iconPath = new vscode.ThemeIcon('tasklist');
        this.tooltip = `Task: ${label}\nPath: ${taskPath}`;
      }
    }
  }
}

export class EpicsTreeDataProvider implements vscode.TreeDataProvider<EpicTreeItem>, vscode.TreeDragAndDropController<EpicTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<EpicTreeItem | undefined | void> = new vscode.EventEmitter<EpicTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<EpicTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  // DragAndDrop
  readonly dropMimeTypes = ['application/vnd.code.tree.sprintdesk-tasks'];
  readonly dragMimeTypes: string[] = [];
  private workspaceRoot: string;

  constructor() {
    // Initialize workspace root
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder found');
    }
    this.workspaceRoot = folders[0].uri.fsPath;
  }

  private async getTasksFromEpicName(epicName: string): Promise<EpicTreeItem[]> {
      const treeItems = epicService.getTasksFromEpic(epicName);
      return treeItems.map(item => {
        const treeItem = new EpicTreeItem(
          item.label,
          item.collapsibleState,
          [],
          undefined,
          item.path,
          epicName
        );
        if (item.command) {
          treeItem.command = item.command;
        }
        treeItem.tooltip = `Task: ${item.label}\nPath: ${item.path}\nEpic: ${epicName}`;
        return treeItem;
      });
    }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  private humanizeEpicName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base
      .replace(/^\[(?:epic|e)\]_?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return cleaned || base;
  }
  private async getEpicsTree(workspaceRoot: string): Promise<EpicTreeItem[]> {
      const epicsDir = path.join(workspaceRoot, PROJECT.SPRINTDESK_DIR, PROJECT.EPICS_DIR);
      const files = fileService.listMdFiles(epicsDir);

      const items = files.map(name => {
        const filePath = path.join(epicsDir, name);
        const label = this.humanizeEpicName(name);
        return new EpicTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
      });
  
      items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  
      return items;
    }
  getTreeItem(element: EpicTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EpicTreeItem): Promise<EpicTreeItem[]> {
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


  // Implement drag and drop
  async handleDrop(target: EpicTreeItem, dataTransfer: vscode.DataTransfer): Promise<void> {
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      throw new Error('No workspace folder found');
    }
    try {
      const taskDataItem = dataTransfer.get('application/vnd.code.tree.sprintdesk-tasks');
      if (!taskDataItem || target.contextValue !== 'epic') return;

      const handleData = JSON.parse(taskDataItem.value as string);

      // Resolve task path: prefer explicit fields, then legacy itemHandles using exact basename extraction
      let taskPath: string | undefined;
      let taskIdFromData: string | undefined;
      if (handleData.path) taskPath = handleData.path, taskIdFromData = handleData._id;
      else if (handleData.filePath) taskPath = handleData.filePath, taskIdFromData = handleData._id;
      else if (handleData.taskPath) taskPath = handleData.taskPath, taskIdFromData = handleData._id;
      else if (handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
        // exact extraction per request: itemHandles[0].split(' ')[1]
        const raw = String(handleData.itemHandles[0] || '');
        const parts = raw.split(' ');
        const maybeBase = parts[1] || parts.pop() || raw;
        let base = path.basename(maybeBase).trim();
        if (!base.toLowerCase().endsWith('.md')) base = `${base}.md`;
        taskPath = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR, base);
      } else {
        throw new Error('No task path found in drop data');
      }

      if (!taskPath) throw new Error('No task path resolved');
      if (!fs.existsSync(taskPath)) throw new Error(`Task file not found: ${taskPath}`);

      // Read both task and epic files
      const taskContent = fs.readFileSync(taskPath, 'utf8');
      const taskMatter = matter(taskContent);
      const taskId = taskIdFromData || taskMatter.data._id;

      // Read epic file
      const epicContent = fs.readFileSync(target.filePath, 'utf8');
      const epicMatter = matter(epicContent);

      // Initialize tasks array if it doesn't exist
      if (!Array.isArray(epicMatter.data.tasks)) {
        epicMatter.data.tasks = [];
      }

      // Create task data object to save inside the epic frontmatter
      const taskData = {
        _id: taskId,
        name: taskMatter.data.title || taskMatter.data.name,
        status: taskMatter.data.status || 'not-started',
        file: path.relative(path.dirname(target.filePath), taskPath).replace(/\\/g, '/'),
        description: taskMatter.data.description || '',
        priority: taskMatter.data.priority || 'medium'
      };

      // Add task to epic's tasks array
      const existingTaskIndex = epicMatter.data.tasks.findIndex((t: any) => t._id === taskId);
      if (existingTaskIndex >= 0) {
        epicMatter.data.tasks[existingTaskIndex] = taskData;
      } else {
        epicMatter.data.tasks.push(taskData);
      }

      // Confirm with the user before writing
      const confirm = await vscode.window.showInformationMessage(`Add task "${taskData.name}" to epic "${path.basename(target.filePath)}"?`, { modal: true }, 'Add');
      if (confirm !== 'Add') return;

      // Write back the epic file (use parsed content to preserve body)
      fs.writeFileSync(target.filePath, matter.stringify(epicMatter.content, epicMatter.data));

      // Now execute the command to handle any additional processing
      await vscode.commands.executeCommand('sprintdesk.addTaskToEpic', {
        epicId: target.epicId,
        epicPath: target.filePath,
        taskId: taskId,
        taskPath: taskPath
      });

      // Refresh both providers
      this.refresh();
      vscode.commands.executeCommand('sprintdesk.refresh');

      // Show success message
      vscode.window.showInformationMessage('Task added to epic successfully');
    } catch (error) {
      console.error('Drop error:', error);
      vscode.window.showErrorMessage('Failed to add task to epic: ' + (error as Error).message);
    }
  }

  handleDrag(source: EpicTreeItem[], dataTransfer: vscode.DataTransfer): void {
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
          backlog: {
            type: 'epic',
            backlogName: taskItem.sourceEpicPath || taskItem.filePath
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
    return;
  }

  private getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}