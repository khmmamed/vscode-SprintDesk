import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import * as taskController from '../controller/taskController';
import * as fileService from '../services/fileService';
interface TaskData {
  _id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  epic?: {
    _id: string;
    title: string;
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
    super(taskData.title, collapsibleState);
    this.taskData = taskData;

    // Set task context and make draggable
    this.contextValue = 'task';
    this.resourceUri = vscode.Uri.file(fileService.createTaskRelativePath(taskData.title));

    // Set up visual elements
    this.setupVisuals();

    // Make clickable to open
    this.command = {
      command: 'vscode.open',
      title: 'Open Task',
      arguments: [vscode.Uri.file(fileService.createTaskRelativePath(taskData.title))]
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
 
    const statusEmoji = this.getStatusEmoji(this.taskData.status);
    this.label = `${statusEmoji} ${path.basename(this.taskData.path)} `;

    // Set description with priority and epic
    const description = [this.getPriorityEmoji(this.taskData.priority)];
    if (this.taskData.epic?.title) {
      description.push(`📘 ${this.taskData?.epic?.title || 'No Epic'}`);
    }
    this.description = description.join(' ');

    // Set detailed tooltip
    this.tooltip = new vscode.MarkdownString()
      .appendMarkdown(`**${this.taskData.title}**\n\n`)
      .appendMarkdown(`${this.getStatusEmoji(this.taskData.status)} Status: ${this.taskData.status}\n`)
      .appendMarkdown(`${this.getPriorityEmoji(this.taskData.priority)} Priority: ${this.taskData.priority}\n`)
      .appendMarkdown(`${this.getTypeIcon(this.taskData.type)} Type: ${this.taskData.type || 'feature'}\n`)
      .appendMarkdown(this.taskData.epic ? `\n📘 Epic: ${this.taskData.epic.title}\n` : '')
      .appendMarkdown(`\n📁 Path: \`${this.taskData.path}\``);
  }
}

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem>, vscode.TreeDragAndDropController<TaskTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | void> = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  // Drag and Drop implementation
  public readonly dropMimeTypes: string[] = [];
  public readonly dragMimeTypes: string[] = ['application/vnd.code.tree.sprintdesk-tasks'];

  constructor(private workspaceRoot?: string) { }

  /**
   * Update the workspace root (repository root) where tasks are read from.
   * Pass `undefined` to reset to the default workspace folder.
   */
  public setWorkspaceRoot(root?: string) {
    this.workspaceRoot = root;
    this.refresh();
  }

  // Any task dropped from epic sprint backlog should be removed from there,
  // and returned to the main tasks list.
  public handleDrop(): void { }

  public handleDrag(source: readonly TaskTreeItem[], dataTransfer: vscode.DataTransfer): void {
    if (!source[0]) return;

    const taskItem = source[0];
    const taskData = taskItem.taskData;

    // Create a direct task data transfer without wrapping
    const transferData = {
      _id: taskData._id,
      title: taskData.title,
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
      const taskFiles = taskController.readTasks(ws);

      return taskFiles.map(file => {

        try {
          const { data } = matter.read(file);

          // Create structured task data
          const taskData = {
            _id: data._id,
            title: data.title,
            type: data.type,
            status: data.status || 'not-started',
            priority: data.priority || 'low',
            epic: data.epic,
            path: data.path
          };

          // Create TreeItem with taskData
          const item = new TaskTreeItem(taskData);

          return item;
        } catch (error) {
          console.error(`Error creating task item:`, error);
          return null;
        }
      }).filter(item => item !== null) as TaskTreeItem[];
    }

    return [];
  }

}
