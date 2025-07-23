import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class TasksTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TasksTreeItem[] = []
  ) {
    super(label, collapsibleState);
  }
}

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TasksTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TasksTreeItem | undefined | void> = new vscode.EventEmitter<TasksTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TasksTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {}

  getTreeItem(element: TasksTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TasksTreeItem): Thenable<TasksTreeItem[]> {
    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }
    if (!element) {
      // Flat list: each task with its epic title
      return Promise.resolve(this.getAllTasksWithEpics());
    }
    return Promise.resolve([]);
  }

  private getAllTasksWithEpics(): TasksTreeItem[] {
    const tasksDir = path.join(this.workspaceRoot, '.SprintDesk', 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    const files = fs.readdirSync(tasksDir);
    const tasks: TasksTreeItem[] = [];
    for (const file of files) {
      const match = file.match(/^\[Task\]_(.+)_\[Epic\]_(.+)\.md$/);
      if (match) {
        const taskTitle = match[1];
        const epicTitle = match[2];
        tasks.push(Object.assign(
          new TasksTreeItem(`📌${taskTitle}`, vscode.TreeItemCollapsibleState.None),
          { description: `🚩${epicTitle}` }
        ));
      }
    }
    return tasks;
  }

}
