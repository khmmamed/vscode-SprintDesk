import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

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

  async getChildren(element?: TasksTreeItem): Promise<TasksTreeItem[]> {
    if (!this.workspaceRoot) {
      return [];
    }
    if (!element) {
      // Flat list: each task with its epic title and last commit datetime
      return this.getAllTasksWithEpics();
    }
    return [];
  }

  private async getAllTasksWithEpics(): Promise<TasksTreeItem[]> {
    const tasksDir = path.join(this.workspaceRoot, '.SprintDesk', 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    const files = fs.readdirSync(tasksDir);
    const tasks: TasksTreeItem[] = [];
    const promises = files.map(file => {
      const match = file.match(/^\[Task\]_(.+)_\[Epic\]_(.+)\.md$/);
      if (match) {
        const taskTitle = match[1];
        const epicTitle = match[2];
        const filePath = path.join(tasksDir, file);
        return this.getLastCommitDate(filePath).then(date => {
          const desc = `🚩${epicTitle} | 🕒 ${date}`;
          return Object.assign(
            new TasksTreeItem(`📌${taskTitle}`, vscode.TreeItemCollapsibleState.None),
            { description: desc }
          );
        });
      }
      return null;
    });
    const results = await Promise.all(promises);
    return results.filter(Boolean) as TasksTreeItem[];
  }

  private getLastCommitDate(filePath: string): Promise<string> {
    return new Promise(resolve => {
      exec(
        `git log -1 --format=%ci -- "${filePath}"`,
        { cwd: this.workspaceRoot },
        (err, stdout) => {
          if (err || !stdout) {
            resolve('N/A');
          } else {
            resolve(stdout.trim());
          }
        }
      );
    });
  }
}
