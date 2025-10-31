import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as backlogService from '../services/backlogService';
import { UI } from '../utils/constant';
import matter from 'gray-matter';

export class BacklogsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: BacklogsTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceBacklogPath?: string
  ) {
    super(label, collapsibleState);
    
    if (filePath) {
      // Setup backlog item
      this.contextValue = 'backlog';
      this.resourceUri = vscode.Uri.file(filePath);
      
      // Count tasks in backlog
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const taskCount = (content.match(/^-\s*✅/gm) || []).length;
        this.description = `${UI.EMOJI.COMMON.TASK_LIST} ${taskCount} tasks`;
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
        const content = fs.readFileSync(taskPath, 'utf8');
        const taskData = content.match(/^status:\s*(.+)|^priority:\s*(.+)|^type:\s*(.+)/gm);
        
        // Extract status and priority if available
        let status = 'not-started';
        let priority = '';
        let type = '';
        
        taskData?.forEach(line => {
          if (line.startsWith('status:')) status = line.replace('status:', '').trim();
          if (line.startsWith('priority:')) priority = line.replace('priority:', '').trim();
          if (line.startsWith('type:')) type = line.replace('type:', '').trim();
        });

        // Map status to emoji
        const statusKey = status.toUpperCase().replace(/-/g, '_') as keyof typeof UI.EMOJI.STATUS;
        const statusEmoji = UI.EMOJI.STATUS[statusKey] || UI.EMOJI.STATUS.NOT_STARTED;
        this.label = `${statusEmoji} ${label}`;

        // Add priority if available
        if (priority) {
          const priorityKey = priority.toUpperCase() as keyof typeof UI.EMOJI.PRIORITY;
          const priorityEmoji = UI.EMOJI.PRIORITY[priorityKey] || '';
          this.description = priorityEmoji;
        }

        // Set icon based on type
        this.iconPath = new vscode.ThemeIcon(type?.toLowerCase().includes('bug') ? 'bug' : 'tasklist');

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

export class BacklogsTreeDataProvider implements vscode.TreeDataProvider<BacklogsTreeItem>, vscode.TreeDragAndDropController<BacklogsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BacklogsTreeItem | undefined | void> = new vscode.EventEmitter<BacklogsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BacklogsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private treeView: vscode.TreeView<BacklogsTreeItem>;
  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-backlogs'];

  constructor() {
    // Initialize workspace root
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder found');
    }
    this.workspaceRoot = folders[0].uri.fsPath;

    // Create tree view
    this.treeView = vscode.window.createTreeView('sprintdesk-backlogs', {
      treeDataProvider: this,
      dragAndDropController: this,
      canSelectMany: true
    });
  }

  handleDrag(source: readonly BacklogsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];
        if (!taskItem.taskPath) {
          throw new Error('No task path found for drag operation');
        }

        // Create a consistent task data object
        const taskData = {
          id: path.basename(taskItem.taskPath, '.md'),
          label: taskItem.label,
          filePath: taskItem.taskPath,
          type: 'task',
          sourceContainer: {
            type: 'backlog',
            path: taskItem.sourceBacklogPath || taskItem.filePath
          }
        };
        
        dataTransfer.set('application/vnd.code.tree.sprintdesk-backlogs', 
          new vscode.DataTransferItem(JSON.stringify(taskData))
        );
        
        void vscode.window.showInformationMessage(`Dragging task: ${taskItem.label}`);
      }
    } catch (error) {
      console.error('Drag error:', error);
      void vscode.window.showErrorMessage('Failed to start drag: ' + (error as Error).message);
    }
  }

  async handleDrop(target: BacklogsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      // Check for tasks from various sources
      const taskSources = [
        { mimeType: 'application/vnd.code.tree.sprintdesk-tasks', source: 'Tasks' },
        { mimeType: 'application/vnd.code.tree.sprintdesk-backlogs', source: 'Backlogs' },
        { mimeType: 'application/vnd.code.tree.sprintdesk-epics', source: 'Epics' },
        { mimeType: 'application/vnd.code.tree.sprintdesk-sprints', source: 'Sprints' }
      ];

      let handleData: any = null;
      let sourceType: string = '';
      let taskDataItem: vscode.DataTransferItem | undefined;

      for (const source of taskSources) {
        taskDataItem = dataTransfer.get(source.mimeType);
        if (taskDataItem) {
          handleData = JSON.parse(taskDataItem.value as string);
          sourceType = source.source;
          break;
        }
      }

      if (taskDataItem && target?.filePath && target.contextValue === 'backlog') {
        // Handle drop from any source
        console.log(`Received drop data from ${sourceType}:`, handleData);

        // Handle the new task data format
        let taskPath: string;
        if (handleData.filePath) {
          // New format from tasks view
          taskPath = handleData.filePath;
        } else if (handleData.taskPath) {
          // Format from sprints/backlogs views
          taskPath = handleData.taskPath;
        } else {
          throw new Error('No task path found in drop data');
        }

        if (!fs.existsSync(taskPath)) {
          throw new Error(`Task file not found: ${taskPath}`);
        }

        // Read the task content to get metadata and the backlog content
        const taskContent = fs.readFileSync(taskPath, 'utf8');
        const backlogContent = fs.readFileSync(target.filePath, 'utf8');
        const taskMatter = matter(taskContent);
        const taskName = taskMatter.data.title || taskMatter.data.name || 
          path.basename(taskPath, '.md').replace(/^\[Task\]_/, '').replace(/-/g, ' ');

        // Find the Tasks section or create it if it doesn't exist
        const tasksSectionMarker = UI.SECTIONS.TASKS_MARKER;
        let updatedContent = backlogContent;

        if (!backlogContent.includes(tasksSectionMarker)) {
          // If no Tasks section exists, add it at the end
          updatedContent += `\n\n${tasksSectionMarker}\n`;
        }

        // Add the task reference
        const taskLink = `- ${UI.EMOJI.COMMON.TASK} [${taskName}](${path.relative(path.dirname(target.filePath), taskPath).replace(/\\/g, '/')})`;
        
        // Insert the task link after the Tasks section
        const tasksIndex = updatedContent.indexOf(tasksSectionMarker);
        if (tasksIndex !== -1) {
          updatedContent = updatedContent.slice(0, tasksIndex + tasksSectionMarker.length) +
            '\n' + taskLink +
            updatedContent.slice(tasksIndex + tasksSectionMarker.length);
        }

        // Write the updated content back to the backlog file
        fs.writeFileSync(target.filePath, updatedContent);

        this.refresh();
        void vscode.window.showInformationMessage(`Task added to backlog: ${target.label}`);
        return;
      }

      // Handle drops from other backlogs
      const backlogDataItem = dataTransfer.get('application/vnd.code.tree.sprintdesk-backlogs');
      const sources = backlogDataItem?.value as Array<{label: string, taskPath: string, sourceBacklogPath: string}> | undefined;

      if (!sources || !target?.filePath || sources.length === 0) {
        throw new Error('Invalid drop: missing required data');
      }

      void vscode.window.showInformationMessage(`Moving task to: ${target.label}`);

      // Read target backlog content
      let targetContent = fs.readFileSync(target.filePath, 'utf8');

      // Find or create Tasks section
      const tasksSectionMarker = UI.SECTIONS.TASKS_MARKER;
      if (!targetContent.includes(tasksSectionMarker)) {
        targetContent += `\n\n${tasksSectionMarker}\n`;
      }

      // Add each task to the target backlog
      for (const source of sources) {
        if (!source.taskPath) {
          continue;
        }

        // Create task link
        const taskName = path.basename(source.taskPath, '.md')
          .replace(/^\[Task\]_/, '')
          .replace(/-/g, ' ');

        const taskLink = `- ${UI.EMOJI.COMMON.TASK} [${taskName}](${path.relative(path.dirname(target.filePath), source.taskPath).replace(/\\/g, '/')})`;
        
        // Insert the task link after the Tasks section
        const tasksIndex = targetContent.indexOf(tasksSectionMarker);
        if (tasksIndex !== -1) {
          targetContent = targetContent.slice(0, tasksIndex + tasksSectionMarker.length) +
            '\n' + taskLink +
            targetContent.slice(tasksIndex + tasksSectionMarker.length);
        }

        // If it's from another backlog, remove it from the source backlog
        if (source.sourceBacklogPath && source.sourceBacklogPath !== target.filePath) {
          const sourceContent = fs.readFileSync(source.sourceBacklogPath, 'utf8');
          const relativeTaskPath = path.relative(path.dirname(source.sourceBacklogPath), source.taskPath).replace(/\\/g, '/');
          const taskPattern = new RegExp(`^.*\\[.*?\\]\\(${relativeTaskPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\).*$`, 'gm');
          const updatedSourceContent = sourceContent.replace(taskPattern, '').replace(/\n\n\n+/g, '\n\n');
          fs.writeFileSync(source.sourceBacklogPath, updatedSourceContent);
        }
      }

      // Write updated content to target backlog
      fs.writeFileSync(target.filePath, targetContent);
      this.refresh();
    } catch (error: unknown) {
      console.error('Drop error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to move task: ${errorMessage}`);
    }
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BacklogsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BacklogsTreeItem): Promise<BacklogsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];

    if (!element) {
      return this.getBacklogs(workspaceRoot);
    }

    if (element.filePath) {
      return this.getTasksFromBacklogFile(element.filePath);
    }

    return [];
  }

  private getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private async getBacklogs(workspaceRoot: string): Promise<BacklogsTreeItem[]> {
    const backlogsDir = path.join(workspaceRoot, '.SprintDesk', 'Backlogs');
    const files = fileService.listMdFiles(backlogsDir);

    const items = files.map(name => {
      const filePath = path.join(backlogsDir, name);
      const label = this.humanizeBacklogName(name);
      return new BacklogsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    return items;
  }

  private humanizeBacklogName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base
      .replace(/^\[(?:backlog|b)\]_?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return cleaned || base;
  }

  private async getTasksFromBacklogFile(filePath: string): Promise<BacklogsTreeItem[]> {
    const treeItems = backlogService.getTasksFromBacklog(filePath);
    return treeItems.map(item => {
      const treeItem = new BacklogsTreeItem(
        item.label,
        item.collapsibleState,
        [],
        undefined,
        item.taskPath,
        filePath  // Pass the current backlog's path as sourceBacklogPath
      );
      if (item.command) {
        treeItem.command = item.command;
      }
      treeItem.tooltip = `Task: ${item.label}\nPath: ${item.taskPath}\nBacklog: ${filePath}`;
      return treeItem;
    });
  }
}