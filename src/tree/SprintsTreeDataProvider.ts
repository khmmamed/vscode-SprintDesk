import * as vscode from 'vscode';

export class SprintsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: SprintsTreeItem[] = []
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

  getChildren(element?: SprintsTreeItem): Thenable<SprintsTreeItem[]> {
    if (!element) {
      // Root folders (Sprints)
      return Promise.resolve([
        new SprintsTreeItem('Sprint 1', vscode.TreeItemCollapsibleState.Collapsed, [
          new SprintsTreeItem('Task A', vscode.TreeItemCollapsibleState.None),
          new SprintsTreeItem('Task B', vscode.TreeItemCollapsibleState.None)
        ]),
        new SprintsTreeItem('Sprint 2', vscode.TreeItemCollapsibleState.Collapsed, [
          new SprintsTreeItem('Task C', vscode.TreeItemCollapsibleState.None)
        ])
      ]);
    }
    return Promise.resolve(element.children);
  }
}
