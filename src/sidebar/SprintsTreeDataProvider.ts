import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SprintsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: SprintsTreeItem[] = [],
    public readonly filePath?: string // for sprint items, keep a reference to the file on disk
  ) {
    super(label, collapsibleState);
  }
}

export class SprintsTreeDataProvider implements vscode.TreeDataProvider<SprintsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SprintsTreeItem | undefined | void> = new vscode.EventEmitter<SprintsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SprintsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  getTreeItem(element: SprintsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SprintsTreeItem): Promise<SprintsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    if (!element) {
      // Root level: list all sprint files under .SprintDesk/Sprints
      return this.getSprints(workspaceRoot);
    }

    // Child level: list tasks found under "# Tasks" in the sprint file
    if (element.filePath) {
      return this.getTasksFromSprintFile(element.filePath);
    }

    return [];
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  private async getSprints(workspaceRoot: string): Promise<SprintsTreeItem[]> {
    const sprintsDir = path.join(workspaceRoot, '.SprintDesk', 'Sprints');
    if (!fs.existsSync(sprintsDir)) return [];

    const entries = fs.readdirSync(sprintsDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);

    const sprintItems = files.map(name => {
      const filePath = path.join(sprintsDir, name);
      const label = this.humanizeSprintName(name);
      return new SprintsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
    });

    // Sort by label for stable ordering
    sprintItems.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    return sprintItems;
  }

  private humanizeSprintName(filename: string): string {
    // Strip extension
    const base = filename.replace(/\.[^.]+$/, '');
    // Replace underscores/dashes with spaces and trim brackets-style prefixes
    const cleaned = base
      .replace(/^\[(?:Sprint|S)\]_?/i, '')
      .trim();
    return cleaned || base;
  }

  private async getTasksFromSprintFile(filePath: string): Promise<SprintsTreeItem[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Capture the section after a heading "# Tasks" up to the next heading of any level
      const sectionMatch = content.match(/(^|\r?\n)#{1,6}\s*Tasks\b[^\n]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s+\S|\s*$)/i);
      if (!sectionMatch) return [];
      const section = sectionMatch[2] ?? '';

      const tasks: string[] = [];

      // Match unordered list items, with optional checkboxes
      const ulRegex = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = ulRegex.exec(section)) !== null) {
        tasks.push(m[1].trim());
      }

      // Also match ordered list items like "1. Task" or "1) Task"
      const olRegex = /^\s*\d+[\.)]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      while ((m = olRegex.exec(section)) !== null) {
        tasks.push(m[1].trim());
      }

      // Deduplicate while preserving order
      const uniqueTasks = Array.from(new Set(tasks));

      return uniqueTasks.map(t => new SprintsTreeItem(t, vscode.TreeItemCollapsibleState.None));
    } catch (e) {
      return [];
    }
  }
}
