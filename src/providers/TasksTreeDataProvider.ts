import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';

interface TaskData {
  _id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  epic?: {
    _id: string;
    name: string;
    path: string;
  };
  path: string;
}

export class TaskTreeItem extends vscode.TreeItem {
  public readonly taskData: TaskData;

  constructor(
    taskData: TaskData,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    // Create base TreeItem with initial label
    super(taskData.name, collapsibleState);
    this.taskData = taskData;
    
    // Set task context and make draggable
    this.contextValue = 'task';
    this.resourceUri = vscode.Uri.file(taskData.path);
    
    // Set up visual elements
    this.setupVisuals();
    
    // Make clickable to open
    this.command = {
      command: 'vscode.open',
      title: 'Open Task',
      arguments: [vscode.Uri.file(taskData.path)]
    };
  }

  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'not-started': return '⏳';
      case 'in-progress': return '🔄';
      case 'done': return '✅';
      case 'blocked': return '⛔';
      default: return '⏳';
    }
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority.toLowerCase()) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  private getTypeIcon(type: string): string {
    switch (type?.toLowerCase()) {
      case 'bug': return '🐛';
      case 'feature': return '✨';
      case 'chore': return '🔧';
      case 'doc': return '📝';
      case 'test': return '🧪';
      default: return '✨';
    }
  }

  private setupVisuals(): void {
    // Set the main label with status
    const statusEmoji = this.getStatusEmoji(this.taskData.status);
    const typeIcon = this.getTypeIcon(this.taskData.type);
    this.label = `${statusEmoji} ${path.basename(this.taskData.path)} `;

    // Set description with priority and epic
    const description = [this.getPriorityEmoji(this.taskData.priority)];
    if (this.taskData.epic?.name) {
      description.push(`${typeIcon} 📘 ${this.taskData?.epic?.name || 'No Epic'}`);
    }
    this.description = description.join(' ');

    // Set detailed tooltip
    this.tooltip = new vscode.MarkdownString()
      .appendMarkdown(`**${this.taskData.name}**\n\n`)
      .appendMarkdown(`${this.getStatusEmoji(this.taskData.status)} Status: ${this.taskData.status}\n`)
      .appendMarkdown(`${this.getPriorityEmoji(this.taskData.priority)} Priority: ${this.taskData.priority}\n`)
      .appendMarkdown(`${this.getTypeIcon(this.taskData.type)} Type: ${this.taskData.type || 'feature'}\n`)
      .appendMarkdown(this.taskData.epic ? `\n📘 Epic: ${this.taskData.epic.name}\n` : '')
      .appendMarkdown(`\n📁 Path: \`${this.taskData.path}\``);
  }
}

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem>, vscode.TreeDragAndDropController<TaskTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | void> = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  // Drag and Drop implementation
  public readonly dropMimeTypes: string[] = [];
  public readonly dragMimeTypes: string[] = ['application/vnd.code.tree.sprintdesk-tasks'];

  constructor(private workspaceRoot?: string) {}

  public handleDrop(): void {}
  
  public handleDrag(source: readonly TaskTreeItem[], dataTransfer: vscode.DataTransfer): void {
    if (!source[0]) return;
    
    const taskItem = source[0];
    const taskData = taskItem.taskData;

    // Create a direct task data transfer without wrapping
    const transferData = {
      _id: taskData._id,
      name: taskData.name,
      type: taskData.type,
      status: taskData.status,
      priority: taskData.priority,
      epic: taskData.epic,
      path: taskData.path
    };
    
    dataTransfer.set('application/vnd.code.tree.sprintdesk-tasks', 
      new vscode.DataTransferItem(JSON.stringify(transferData))
    );
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeItem): Promise<TaskTreeItem[]> {
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      return [];
    }

    if (!element) {
      // Root level: list all tasks under .SprintDesk/Tasks
  const tasksDir = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
      if (!fs.existsSync(tasksDir)) {
        return [];
      }

      const taskFiles = fs.readdirSync(tasksDir).filter(file => 
  file.startsWith(PROJECT_CONSTANTS.FILE_PREFIX.TASK) && file.endsWith(PROJECT_CONSTANTS.MD_FILE_EXTENSION)
      );

      return taskFiles.map(file => {
        const filePath = path.join(tasksDir, file);
        if (!fs.existsSync(filePath)) {
          console.warn(`Task file not found: ${filePath}`);
          return null;
        }

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const { data } = matter(content);

          // Create structured task data
          const taskData = {
            _id: data._id,
            name: data.name,
            type: data.type,
            status: data.status || 'not-started',
            priority: data.priority || 'low',
            epic: data.epic ? {
              _id: data.epic._id,
              name: data.epic.name,
              path: data.epic.file
            } : undefined,
            path: filePath
          };
          
          // Create TreeItem with taskData
          const item = new TaskTreeItem(taskData);

          return item;
        } catch (error) {
          console.error(`Error creating task item for ${file}:`, error);
          return null;
        }
      }).filter(item => item !== null) as TaskTreeItem[];
    }

    return [];
  }

  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'not-started': return '⏳';
      case 'in-progress': return '🔄';
      case 'done': return '✅';
      case 'blocked': return '⛔';
      default: return '⏳';
    }
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority.toLowerCase()) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  private getTypeIcon(type: string): string {
    switch (type?.toLowerCase()) {
      case 'bug': return '🐛';
      case 'feature': return '✨';
      case 'chore': return '🔧';
      case 'doc': return '📝';
      case 'test': return '🧪';
      default: return '✨';
    }
  }
}
