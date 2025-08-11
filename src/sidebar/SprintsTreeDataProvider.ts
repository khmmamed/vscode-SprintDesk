import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SprintsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: SprintsTreeItem[] = [],
    public readonly filePath?: string, // for sprint items, reference to the sprint file on disk
    public readonly taskSlug?: string, // for task child items, original slug (e.g., add-status-to-product)
    public readonly taskFilePath?: string, // for task child items, resolved file path to the task file
    public readonly sprintFilePath?: string // for task child items, sprint file path containing the task
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

    const items = await Promise.all(files.map(async (name) => {
      const filePath = path.join(sprintsDir, name);
      // Prefer parsing from filename based on the required pattern
      const range = this.parseDateRangeFromFilename(name) || this.parseSprintDateRangeFromFile(filePath);
      let label: string;
      if (range) {
        const [start, end] = range;
        label = `📅 ${this.formatDMY(start)} ➜ ${this.formatDMY(end)}`;
      } else {
        // Fallback to humanized filename if no dates found
        label = this.humanizeSprintName(name);
      }
      const item = new SprintsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
      item.contextValue = 'sprint';
      return item;
    }));

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    return items;
  }

  private humanizeSprintName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base.replace(/^\[(?:Sprint|S)\]_?/i, '').replace(/[_-]+/g, ' ').trim();
    return cleaned || base;
  }

  private formatDMY(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  private parseSprintDateRangeFromFile(filePath: string): [Date, Date] | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const isoRegex = /(\d{4})-(\d{2})-(\d{2})/g; // yyyy-mm-dd
      const dmyRegex = /(\d{2})-(\d{2})-(\d{4})/g; // dd-mm-yyyy
      const dates: Date[] = [];
      let m: RegExpExecArray | null;
      while ((m = isoRegex.exec(content)) && dates.length < 2) {
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        dates.push(d);
      }
      if (dates.length < 2) {
        while ((m = dmyRegex.exec(content)) && dates.length < 2) {
          const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
          dates.push(d);
        }
      }
      if (dates.length >= 2) {
        const [a, b] = dates;
        return a <= b ? [a, b] as [Date, Date] : [b, a] as [Date, Date];
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseDateRangeFromFilename(name: string): [Date, Date] | null {
    // Expected filename pattern (without extension): [Sprint]_dd-mm_dd-mm_yyyy or [Sprint]_dd-mm_dd-mm_yy
    const base = name.replace(/\.[^.]+$/, '');
    const re = /^\[(?:Sprint|S)\]_(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{2,4})$/i;
    const m = base.match(re);
    if (!m) return null;
    const d1 = parseInt(m[1], 10);
    const m1 = parseInt(m[2], 10) - 1;
    const d2 = parseInt(m[3], 10);
    const m2 = parseInt(m[4], 10) - 1;
    let y = parseInt(m[5], 10);
    if (m[5].length === 2) {
      y = 2000 + y; // assume 20xx for two-digit years
    }
    const start = new Date(y, m1, d1);
    const end = new Date(y, m2, d2);
    return start <= end ? [start, end] : [end, start];
  }

  private getStatusEmojiFromText(text: string): string {
    const m = text.match(/\{[^}]*status\s*:\s*([a-z]+)[^}]*\}/i);
    const status = m ? m[1].toLowerCase() : '';
    switch (status) {
      case 'waiting':
        return '🟡';
      case 'started':
        return '🔵';
      case 'finished':
        return '🟢';
      case 'reopened':
        return '🟠';
      case 'closed':
        return '⚫';
      default:
        return '';
    }
  }

  private async getTasksFromSprintFile(filePath: string): Promise<SprintsTreeItem[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const sectionMatch = content.match(/(^|\r?\n)#{1,6}\s*Tasks\b[^\n]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s+\S|\s*$)/i);
      if (!sectionMatch) return [];
      const section = sectionMatch[2] ?? '';

      const rawItems: string[] = [];
      const ulRegex = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = ulRegex.exec(section)) !== null) {
        rawItems.push(m[1].trim());
      }
      const olRegex = /^\s*\d+[\.)]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      while ((m = olRegex.exec(section)) !== null) {
        rawItems.push(m[1].trim());
      }

      const seen = new Set<string>();
      const result: SprintsTreeItem[] = [];
      for (const itemText of rawItems) {
        const linkMatch = itemText.match(/\[([^\]]+)\]\(([^)]+)\)/);
        let labelSlug = linkMatch ? linkMatch[1] : itemText.replace(/^📌\s*/, '').trim();
        const prettyLabel = labelSlug.replace(/[_-]+/g, ' ').trim();
        const emoji = this.getStatusEmojiFromText(itemText);
        const displayLabel = (emoji ? `${emoji} ` : '') + prettyLabel;
        let key = prettyLabel;
        const rel = linkMatch ? linkMatch[2] : undefined;
        const abs = rel ? path.resolve(path.dirname(filePath), rel) : undefined;
        const treeItem = new SprintsTreeItem(displayLabel, vscode.TreeItemCollapsibleState.None, [], undefined, labelSlug, abs, filePath);
        treeItem.contextValue = 'sprintTask';
        if (abs) {
          Object.assign(treeItem, {
            command: {
              command: 'vscode.open',
              title: 'Open Task',
              arguments: [vscode.Uri.file(abs)]
            }
          });
          key = `${prettyLabel}|${abs}`;
        }
        if (!seen.has(key)) {
          seen.add(key);
          result.push(treeItem);
        }
      }

      return result;
    } catch (e) {
      return [];
    }
  }
}
