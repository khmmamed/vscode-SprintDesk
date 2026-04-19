import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import * as taskController from '../controller/taskController';
import * as fileService from '../services/fileService';
import { SprintDeskItem } from '../utils/SprintDeskItem';
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
    // absolute path to the markdown file on disk (preferred)
    absoluteFilePath?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    // Create base TreeItem with initial label
    super(taskData.title, collapsibleState);
    this.taskData = taskData;

    // Set task context and make draggable
    this.contextValue = 'task';
    // Prefer the provided absolute path. If not available, try to resolve
    // using workspace folder and file service helpers.
    let resourceFsPath: string | undefined = undefined;
    if (absoluteFilePath) {
      resourceFsPath = absoluteFilePath;
    } else if (taskData.path) {
      resourceFsPath = taskData.path;
    } else {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      try {
        const rel = fileService.createTaskRelativePath(taskData.title);
        resourceFsPath = fileService.taskRelativePathToAbsolute(rel, ws);
      } catch (e) {
        resourceFsPath = undefined;
      }
    }

    if (resourceFsPath) {
      this.resourceUri = vscode.Uri.file(resourceFsPath);
    }

    // Set up visual elements
    this.setupVisuals();

    // Make primary click open the markdown preview
    if (resourceFsPath) {
      this.command = {
        command: 'sprintdesk.viewTaskPreview',
        title: 'Preview Task',
        arguments: [vscode.Uri.file(resourceFsPath)]
      };
    }
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
          // Use SprintDeskItem class to read task data
          let taskData: any;
          
          try {
            const taskItem = new SprintDeskItem(file);
            const metadata = taskItem.getMetadata();
            
            taskData = {
              _id: metadata._id,
              title: metadata.title,
              type: metadata.type,
              status: metadata.status || 'not-started',
              priority: metadata.priority || 'low',
              epic: metadata.epic,
              path: metadata.path || file // Use absolute file path if metadata.path is undefined
            };
            
            console.log(`✅ Task data read using SprintDeskItem: ${file}`);
          } catch (sprintDeskError) {
            console.error('❌ Failed to read task data with SprintDeskItem, falling back to original method:', sprintDeskError);
            
            // Fallback to original method
            const { data } = matter.read(file);
            taskData = {
              _id: data._id,
              title: data.title,
              type: data.type,
              status: data.status || 'not-started',
              priority: data.priority || 'low',
              epic: data.epic,
              path: data.path || file // Use absolute file path if data.path is undefined
            };
          }

          // Create TreeItem with taskData and pass the absolute file path so
          // the item can open the correct file when clicked.
          const item = new TaskTreeItem(taskData, file);

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
