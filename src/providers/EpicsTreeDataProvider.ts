import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';
import { PROJECT, UI } from '../utils/constant';

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

  constructor(private workspaceRoot?: string) { }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: EpicTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EpicTreeItem): Promise<EpicTreeItem[]> {
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      return [];
    }

    if (!element) {
      // Root level: list all epics under .SprintDesk/Epics
      const epicsDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.EPICS_DIR);
      if (!fs.existsSync(epicsDir)) {
        fs.mkdirSync(epicsDir, { recursive: true });
        return [];
      }

      const epicFiles = fs.readdirSync(epicsDir).filter(file =>
        file.startsWith(PROJECT.FILE_PREFIX.EPIC) && file.endsWith(PROJECT.MD_FILE_EXTENSION)
      );

      return epicFiles.map(file => {
        const filePath = path.join(epicsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const { data } = matter(content);

        const epicName = data.title || file.replace(new RegExp(`^${PROJECT.FILE_PREFIX.EPIC}(.+)${PROJECT.MD_FILE_EXTENSION}$`), '$1').replace(/-/g, ' ');
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
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      throw new Error('No workspace folder found');
    }
    try {
      const taskDataItem = dataTransfer.get('application/vnd.code.tree.sprintdesk-tasks');
      if (!taskDataItem || target.contextValue !== 'epic') {
        return;
      }

      // Parse the transferred data (new format from TasksTreeDataProvider or other sources)
      const handleData = JSON.parse(taskDataItem.value as string);
      console.log('Received drop data:', handleData);

      // Determine task file path from multiple possible properties (new and legacy)
      let taskPath: string | undefined;
      let taskIdFromData: string | undefined;

      if (handleData.path) {
        taskPath = handleData.path;
        taskIdFromData = handleData._id;
      } else if (handleData.filePath) {
        taskPath = handleData.filePath;
        taskIdFromData = handleData._id;
      } else if (handleData.taskPath) {
        taskPath = handleData.taskPath;
        taskIdFromData = handleData._id;
      } else if (handleData.itemHandles?.[0]) {
        // Legacy behavior: parse the tree handle string
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

        const tasksDir = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR);
        const taskFileName = `${PROJECT.FILE_PREFIX.TASK}${cleanTaskName}${PROJECT.MD_FILE_EXTENSION}`;
        taskPath = path.join(tasksDir, taskFileName);
      } else {
        throw new Error('No task path found in drop data');
      }

      console.log('Resolved task path:', taskPath);

      // Ensure we actually resolved a path
      if (!taskPath) {
        throw new Error('No task path resolved from drop data');
      }

      // Verify task file exists
      if (!fs.existsSync(taskPath)) {
        throw new Error(`Task file not found: ${taskPath}`);
      }

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

      // Write back the epic file
      fs.writeFileSync(target.filePath, matter.stringify(epicContent, epicMatter.data));

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