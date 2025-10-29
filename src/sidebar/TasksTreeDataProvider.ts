import * as vscode from 'vscode';
import * as path from 'path';
import * as fileService from '../services/fileService';
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

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

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
    // Support both 'tasks' and emoji-prefixed '🚀_tasks' folders used in templates
    const candidates = fileService.getExistingTasksDirs(this.workspaceRoot);
    const files: string[] = [];
    for (const d of candidates) {
      const entries = fileService.listMdFiles(d).map(f => path.join(d, f));
      files.push(...entries);
    }
    if (!files.length) return [];
    const tasks: TasksTreeItem[] = [];
    const promises = files.map(filePath => {
      const fileName = path.basename(filePath);
      // Accept [Task]_title_[Epic]_epic.md or [Task]_title.md
      const match = fileName.match(/^\[Task\]_(.+?)(?:_\[Epic\]_(.+))?\.md$/i);
      if (match) {
        const taskTitle = match[1];
        const epicTitle = match[2];
        return this.getLastCommitDate(filePath).then(date => {
          const desc = epicTitle ? `🚩${epicTitle} | 🕒 ${date}` : `🕒 ${date}`;
          const prettyLabel = taskTitle.replace(/[_-]+/g, ' ').trim();
          const item = new TasksTreeItem(prettyLabel, vscode.TreeItemCollapsibleState.None);
          return Object.assign(item, {
            description: desc,
            command: {
              command: 'vscode.open',
              title: 'Open Task',
              arguments: [vscode.Uri.file(filePath)]
            }
          });
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
