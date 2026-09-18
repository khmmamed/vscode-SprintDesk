import * as vscode from 'vscode';

export type SourceId =
  | 'people'
  | 'mcp'
  | 'tools'
  | 'models'
  | 'requests'
  | 'plans'
  | 'findings'
  | 'approvals'
  | 'schedules'
  | 'workflows'
  | 'activity'
  | 'history';

type TreeSource = vscode.TreeDataProvider<vscode.TreeItem>;

export class SprintDeskSectionItem extends vscode.TreeItem {
  constructor(
    public readonly sourceId: SourceId,
    label: string,
    icon: string,
    description?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `sprintdeskSection:${sourceId}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description;
  }
}

/**
 * Presents the existing planning and workforce providers in one sidebar tree.
 * Child items are returned unchanged so their commands and context-menu actions
 * continue to receive the original item data.
 */
export class SprintDeskTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly sourceForItem = new WeakMap<vscode.TreeItem, SourceId>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly dragMimeTypes: string[];
  readonly dropMimeTypes: string[];

  private readonly sections: Array<{ id: SourceId; label: string; icon: string; description?: string }> = [
    { id: 'people', label: 'People', icon: 'organization', description: 'Humans, agents, teams, and runs' },
    { id: 'mcp', label: 'MCP', icon: 'server', description: 'Registered MCP servers and their tools' },
    { id: 'tools', label: 'Tools', icon: 'tools', description: 'Tool catalog referenced by agents' },
    { id: 'models', label: 'Models', icon: 'vm', description: 'Registered model profiles assignable to agents' },
    { id: 'requests', label: 'Requests', icon: 'inbox', description: 'Inputs awaiting organization' },
    { id: 'plans', label: 'Plans', icon: 'checklist', description: 'Canonical plan registry' },
    { id: 'findings', label: 'Findings', icon: 'search', description: 'Plan-linked findings' },
    { id: 'approvals', label: 'Approvals', icon: 'bell', description: 'Plan/run-linked approvals' },
    { id: 'schedules', label: 'Schedules', icon: 'calendar', description: 'Scheduled plan materialization' },
    { id: 'workflows', label: 'Workflows', icon: 'project', description: 'Workflow definitions and materialized plans' },
    { id: 'activity', label: 'Activity', icon: 'pulse', description: 'Live event feed' },
    { id: 'history', label: 'History', icon: 'history', description: 'Git and audit history' }
  ];

  constructor(private readonly sources: Record<SourceId, TreeSource>) {
    this.dragMimeTypes = this.collectMimeTypes('dragMimeTypes');
    this.dropMimeTypes = this.collectMimeTypes('dropMimeTypes');
    for (const source of Object.values(sources)) {
      if (source.onDidChangeTreeData) {
        this.disposables.push(source.onDidChangeTreeData(() => this.refresh()));
      }
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
    const itemsBySource = new Map<SourceId, vscode.TreeItem[]>();
    for (const item of source) {
      const sourceId = this.sourceForItem.get(item);
      if (!sourceId) {
        continue;
      }
      const items = itemsBySource.get(sourceId) || [];
      items.push(item);
      itemsBySource.set(sourceId, items);
    }

    for (const [sourceId, items] of itemsBySource) {
      (this.sources[sourceId] as any).handleDrag?.(items, dataTransfer, token);
    }
  }

  handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
    const sourceId = target instanceof SprintDeskSectionItem
      ? target.sourceId
      : target ? this.sourceForItem.get(target) : undefined;
    return sourceId ? (this.sources[sourceId] as any).handleDrop?.(target instanceof SprintDeskSectionItem ? undefined : target, dataTransfer, token) : undefined;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.sections.map(section => new SprintDeskSectionItem(
        section.id,
        section.label,
        section.icon,
        section.description
      ));
    }

    const sourceId = element instanceof SprintDeskSectionItem
      ? element.sourceId
      : this.sourceForItem.get(element);
    if (!sourceId) {
      return [];
    }

    const children = await this.sources[sourceId].getChildren(element instanceof SprintDeskSectionItem ? undefined : element) || [];
    for (const child of children) {
      this.sourceForItem.set(child, sourceId);
    }
    return children;
  }

  private collectMimeTypes(property: 'dragMimeTypes' | 'dropMimeTypes'): string[] {
    return [...new Set(Object.values(this.sources).flatMap(source => (source as any)[property] || []))];
  }
}
