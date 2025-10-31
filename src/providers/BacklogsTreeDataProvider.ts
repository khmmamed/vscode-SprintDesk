import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as backlogService from '../services/backlogService';
import { UI } from '../utils/constant';

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
    
    // Set context value for drag and drop
    if (filePath) {
      this.contextValue = 'backlog';
      this.description = 'Drop target';
      // Add resourceUri to show drop target highlighting
      this.resourceUri = vscode.Uri.file(filePath);
      // Add icon for backlogs
      this.iconPath = new vscode.ThemeIcon('list-unordered');
    } else if (taskPath) {
      this.contextValue = 'task';
      this.description = 'Draggable';
      // Add icon for tasks
      this.iconPath = new vscode.ThemeIcon('tasklist');
    }
  }
}

export class BacklogsTreeDataProvider implements vscode.TreeDataProvider<BacklogsTreeItem>, vscode.TreeDragAndDropController<BacklogsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BacklogsTreeItem | undefined | void> = new vscode.EventEmitter<BacklogsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BacklogsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private treeView: vscode.TreeView<BacklogsTreeItem>;
  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.sprintdesk-backlogs', 'application/vnd.code.tree.sprintdesk-tasks'];
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
    if (source.length > 0) {
      const items = source.map(item => ({
        label: item.label,
        taskPath: item.taskPath,
        sourceBacklogPath: item.sourceBacklogPath || item.filePath
      }));
      dataTransfer.set('application/vnd.code.tree.sprintdesk-backlogs', new vscode.DataTransferItem(items));
      void vscode.window.showInformationMessage(`Dragging task: ${source[0]?.label || 'unknown'}`);
    }
  }

  async handleDrop(target: BacklogsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      // Check for tasks from Tasks view
      const taskDataItem = dataTransfer.get('application/vnd.code.tree.sprintdesk-tasks');
      if (taskDataItem && target?.filePath && target.contextValue === 'backlog') {
        // Handle drop from Tasks view
        const handleData = JSON.parse(taskDataItem.value as string);
        console.log('Received drop data:', handleData);

        if (!handleData.itemHandles?.[0]) {
          throw new Error('No task handle found in drop data');
        }

        const handle = handleData.itemHandles[0];
        const matches = handle.match(/\d+\/\d+:(?:[\u{1F300}-\u{1F9FF}]\s)?(.+)/u);
        if (!matches || !matches[1]) {
          throw new Error('Invalid task handle format');
        }

        const fullTaskName = matches[1].trim();
        const cleanTaskName = fullTaskName
          .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
          .trim()
          .replace(/\s+/g, '-')
          .toLowerCase();

        console.log('Clean task name:', cleanTaskName);

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
          throw new Error('No workspace root found');
        }

        const tasksDir = path.join(workspaceRoot, '.SprintDesk', 'Tasks');
        const taskFileName = `[Task]_${cleanTaskName}.md`;
        const taskPath = path.join(tasksDir, taskFileName);

        if (!fs.existsSync(taskPath)) {
          throw new Error(`Task file not found: ${taskPath}`);
        }

        // Read the task content
        const taskContent = fs.readFileSync(taskPath, 'utf8');
        const backlogContent = fs.readFileSync(target.filePath, 'utf8');

        // Find the Tasks section or create it if it doesn't exist
        const tasksSectionMarker = UI.SECTIONS.TASKS_MARKER;
        let updatedContent = backlogContent;

        if (!backlogContent.includes(tasksSectionMarker)) {
          // If no Tasks section exists, add it at the end
          updatedContent += `\n\n${tasksSectionMarker}\n`;
        }

        // Add the task reference
        const taskLink = `- ${UI.EMOJI.COMMON.TASK} [${fullTaskName}](${path.relative(path.dirname(target.filePath), taskPath).replace(/\\/g, '/')})`;
        
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