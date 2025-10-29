import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';

export class EpicTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly epicId: string,
    public readonly filePath: string
  ) {
    super(label, collapsibleState);
    
    this.tooltip = `${this.label}\nDrag tasks here to add them to this epic`;
    this.contextValue = 'epic';
    
    // Support dropping tasks onto epics
    this.resourceUri = vscode.Uri.file(filePath);
    
    // Make the epic clickable to open it
    this.command = {
      command: 'vscode.open',
      title: 'Open Epic',
      arguments: [vscode.Uri.file(filePath)]
    };

    // Add icon for epics
    this.iconPath = new vscode.ThemeIcon('notebook');
  }
}

export class EpicsTreeDataProvider implements vscode.TreeDataProvider<EpicTreeItem>, vscode.TreeDragAndDropController<EpicTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<EpicTreeItem | undefined | void> = new vscode.EventEmitter<EpicTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<EpicTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  // DragAndDrop
  readonly dropMimeTypes = ['application/vnd.code.tree.sprintdesk-tasks'];
  readonly dragMimeTypes: string[] = [];

  constructor(private workspaceRoot: string) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: EpicTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EpicTreeItem): Promise<EpicTreeItem[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (!element) {
      // Root level: list all epics under .SprintDesk/Epics
      const epicsDir = path.join(this.workspaceRoot, '.SprintDesk', 'Epics');
      if (!fs.existsSync(epicsDir)) {
        fs.mkdirSync(epicsDir, { recursive: true });
        return [];
      }

      const epicFiles = fs.readdirSync(epicsDir).filter(file => 
        file.startsWith('[Epic]_') && file.endsWith('.md')
      );

      return epicFiles.map(file => {
        const filePath = path.join(epicsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const { data } = matter(content);
        
        const epicName = data.title || file.replace(/^\[Epic\]_(.+)\.md$/, '$1').replace(/-/g, ' ');
        const epicId = data._id || `epic_${epicName.toLowerCase().replace(/\s+/g, '_')}`;
        
        // Add epic status emoji if available
        let label = epicName;
        if (data.status) {
          const statusEmoji = this.getStatusEmoji(data.status);
          label = `${statusEmoji} ${epicName}`;
        }

        const item = new EpicTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          epicId,
          filePath
        );

        // Support dropping tasks onto epics
        item.contextValue = 'epic';

        return item;
      });
    }

    // Children level: list tasks under this epic
    try {
      const epicContent = fs.readFileSync(element.filePath, 'utf8');
      const { data } = matter(epicContent);
      
      if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
        return [];
      }

      return data.tasks.map((task: any) => {
        let label = task.name;
        if (task.status) {
          const statusEmoji = this.getTaskStatusEmoji(task.status);
          label = `${statusEmoji} ${task.name}`;
        }

        // Construct absolute file path for task
        const taskPath = path.isAbsolute(task.file) 
          ? task.file 
          : path.resolve(path.dirname(element.filePath), task.file);

        const taskItem = new EpicTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          task._id,
          taskPath
        );

        // Add task details to tooltip
        const priority = task.priority ? this.getPriorityEmoji(task.priority) + ' ' + task.priority : '';
        taskItem.tooltip = new vscode.MarkdownString(
          `**${task.name}**\n\n` +
          (task.description ? `${task.description}\n\n` : '') +
          `Status: ${this.getTaskStatusEmoji(task.status)} ${task.status}\n` +
          (priority ? `Priority: ${priority}\n` : '') +
          `\n[Open Task](${taskPath})`
        );

        // Add icons and metadata
        taskItem.contextValue = 'epic-task';
        taskItem.iconPath = new vscode.ThemeIcon('tasklist');
        taskItem.description = priority; // Show priority in the tree view
        taskItem.command = {
          command: 'vscode.open',
          title: 'Open Task',
          arguments: [vscode.Uri.file(taskPath)]
        };

        return taskItem;
      });
    } catch (error) {
      return [];
    }
  }

  // Implement drag and drop
  async handleDrop(target: EpicTreeItem, dataTransfer: vscode.DataTransfer): Promise<void> {
    const taskData = dataTransfer.get('application/vnd.code.tree.sprintdesk-tasks');
    if (!taskData || target.contextValue !== 'epic') {
      return;
    }

    try {
      // Log for debugging
      console.log('Drop data received:', taskData.value);

      const task = JSON.parse(taskData.value);
      const epicPath = target.filePath;

      console.log('Parsed data:', {
        epicPath: epicPath,
        taskPath: task.taskPath,
        epicId: target.epicId,
        taskId: task.taskId
      });

      // Verify both files exist before proceeding
      if (!epicPath) {
        throw new Error('Epic path is undefined');
      }
      if (!task.taskPath) {
        throw new Error('Task path is undefined');
      }
      if (!fs.existsSync(epicPath)) {
        throw new Error(`Epic file not found: ${epicPath}`);
      }
      if (!fs.existsSync(task.taskPath)) {
        throw new Error(`Task file not found: ${task.taskPath}`);
      }

      await vscode.commands.executeCommand('sprintdesk.addTaskToEpic', {
        epicId: target.epicId,
        epicPath: epicPath,
        taskId: task.taskId,
        taskPath: task.taskPath
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
    // Epics are not draggable
    return;
  }

  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'planned':
      case '⏳ planned': return '⏳';
      case 'in progress':
      case '🔄 in progress': return '🔄';
      case 'completed':
      case '✅ completed': return '✅';
      case 'blocked':
      case '⛔ blocked': return '⛔';
      default: return '⏳';
    }
  }

  private getTaskStatusEmoji(status: string): string {
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
      case 'low': return '🟢';
      default: return '🟡';
    }
  }
}