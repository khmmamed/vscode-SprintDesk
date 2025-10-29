import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';

export class TaskTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly taskId: string,
    public readonly filePath: string
  ) {
    super(label, collapsibleState);
    
    this.tooltip = `${this.label}\nDrag to add to epic`;
    this.contextValue = 'task';
    
    // Make the task draggable
    this.resourceUri = vscode.Uri.file(filePath);
    
    // Make the task clickable to open it
    this.command = {
      command: 'vscode.open',
      title: 'Open Task',
      arguments: [vscode.Uri.file(filePath)]
    };
  }
}

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | void> = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeItem): Promise<TaskTreeItem[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (!element) {
      // Root level: list all tasks under .SprintDesk/Tasks
      const tasksDir = path.join(this.workspaceRoot, '.SprintDesk', 'Tasks');
      if (!fs.existsSync(tasksDir)) {
        return [];
      }

      const taskFiles = fs.readdirSync(tasksDir).filter(file => 
        file.startsWith('[Task]_') && file.endsWith('.md')
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
          
          const taskName = data.title || file.replace(/^\[Task\]_(.+)\.md$/, '$1').replace(/-/g, ' ');
          const taskId = data._id || `tsk_${taskName.toLowerCase().replace(/\s+/g, '_')}`;
          
          // Add task status emoji and epic info if available
          let label = taskName;
          if (data.status) {
            const statusEmoji = this.getStatusEmoji(data.status);
            label = `${statusEmoji} ${taskName}`;
          }
          
          const item = new TaskTreeItem(
            label,
            vscode.TreeItemCollapsibleState.None,
            taskId,
            filePath
          );

          // Add epic information as description if available
          if (data.epic?.name) {
            item.description = `📘 ${data.epic.name}`;
          }

          // Log for debugging
          console.log('Created task item:', {
            label: item.label,
            taskId: item.taskId,
            filePath: item.filePath,
            exists: fs.existsSync(item.filePath)
          });

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
}
