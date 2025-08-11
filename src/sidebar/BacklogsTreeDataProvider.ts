import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
    if (!fs.existsSync(backlogsDir)) return [];

    const entries = fs.readdirSync(backlogsDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);

    const items = files.map(name => {
      const filePath = path.join(backlogsDir, name);
      const label = this.humanizeBacklogName(name);
      return new BacklogsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
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
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Find the section starting with an H2 heading '## Tasks'
      const sectionMatch = content.match(/(^|\r?\n)##\s*Tasks\b[^\n]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s+\S|\s*$)/i);
      if (!sectionMatch) return [];
      const section = sectionMatch[2] ?? '';

      const tasks: string[] = [];
      const ulRegex = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = ulRegex.exec(section)) !== null) {
        tasks.push(m[1].trim());
      }

      const olRegex = /^\s*\d+[\.)]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      while ((m = olRegex.exec(section)) !== null) {
        tasks.push(m[1].trim());
      }

      const unique = Array.from(new Set(tasks));
      return unique.map(t => new BacklogsTreeItem(t, vscode.TreeItemCollapsibleState.None));
    } catch {
      return [];
    }
  }
}
