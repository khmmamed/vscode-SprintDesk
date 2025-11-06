import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class RepositoriesTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly fullPath: string
  ) {
    super(label, collapsibleState);

    this.resourceUri = vscode.Uri.file(fullPath);
    this.contextValue = 'repository';
    this.tooltip = `${fullPath}`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class RepositoriesTreeDataProvider implements vscode.TreeDataProvider<RepositoriesTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<RepositoriesTreeItem | undefined | void> = new vscode.EventEmitter<RepositoriesTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RepositoriesTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoots: string[] = [];
  private excludeDirs = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.vscode', 'vendor', 'bower_components']);

  constructor() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.workspaceRoots = folders.map(f => f.uri.fsPath);
    }
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RepositoriesTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RepositoriesTreeItem): Promise<RepositoriesTreeItem[]> {
    if (!this.workspaceRoots || this.workspaceRoots.length === 0) return [];

    if (element) {
      // No nested children for now
      return [];
    }

    const parents = new Set<string>();

    for (const root of this.workspaceRoots) {
      try {
        await this.scanForSprintDesk(root, parents);
      } catch (err) {
        // ignore errors for individual roots
        console.error('Error scanning root', root, err);
      }
    }

    const items = Array.from(parents).map(p => {
      return new RepositoriesTreeItem(path.basename(p) || p, vscode.TreeItemCollapsibleState.None, p);
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    return items;
  }

  private async scanForSprintDesk(startDir: string, outSet: Set<string>) {
    const stack: string[] = [startDir];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        // unreadable directory, skip
        continue;
      }

      for (const e of entries) {
        try {
          if (e.isDirectory()) {
            if (e.name === '.SprintDesk') {
              // parent directory is the repository/project root we want
              outSet.add(dir);
              // do not descend into the .SprintDesk folder
              continue;
            }

            if (this.excludeDirs.has(e.name)) continue;

            // push subdirectory to stack to scan
            stack.push(path.join(dir, e.name));
          }
        } catch (err) {
          // skip problematic entry
          continue;
        }
      }
    }
  }
}
