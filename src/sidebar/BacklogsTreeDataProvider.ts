import * as vscode from 'vscode';
import * as path from 'path';
import * as fileService from '../services/fileService';
import * as backlogService from '../services/backlogService';

export class BacklogsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: BacklogsTreeItem[] = [],
    public readonly filePath?: string
  ) {
    super(label, collapsibleState);
  }
}

export class BacklogsTreeDataProvider implements vscode.TreeDataProvider<BacklogsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BacklogsTreeItem | undefined | void> = new vscode.EventEmitter<BacklogsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BacklogsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

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

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  private async getBacklogs(workspaceRoot: string): Promise<BacklogsTreeItem[]> {
    const backlogsDir = path.join(workspaceRoot, '.SprintDesk', 'Backlogs');
    const files = fileService.listMdFiles(backlogsDir);

    const items = files.map(name => {
      const filePath = path.join(backlogsDir, name);
      const label = this.humanizeBacklogName(name);
      const item = new BacklogsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
      (item as any).contextValue = 'backlog';
      return item;
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
      const treeItem = new BacklogsTreeItem(item.label, item.collapsibleState);
      if (item.command) {
        treeItem.command = item.command;
      }
      return treeItem;
    });
  }
}
