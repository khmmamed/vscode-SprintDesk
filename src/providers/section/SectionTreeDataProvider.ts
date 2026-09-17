import * as vscode from 'vscode';

/**
 * v1.0 Slice T — shared base for the top-level Control Center sections. Each
 * section is a plain TreeDataProvider whose root `getChildren(undefined)` returns
 * the section's own rows; the SprintDeskTreeDataProvider wrapper delegates and
 * bubbles `onDidChangeTreeData` so a single sidebar refreshes coherently.
 */
export abstract class SectionTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  protected readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  abstract getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>;
}

export const EMPTY_ITEM_CONTEXT = 'sectionEmpty';

export function emptyItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.contextValue = EMPTY_ITEM_CONTEXT;
  return item;
}

export function formatClock(iso?: string): string | undefined {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
}

export function formatStamp(iso?: string): string | undefined {
  return iso ? new Date(iso).toLocaleString() : undefined;
}
