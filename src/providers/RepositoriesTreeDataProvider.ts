import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { RepositoryStateService } from '../services/repositoryState';
import { DataService, getDataService } from '../data/DataService';

export class RepositoriesTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly fullPath: string,
    public readonly nodeType: 'repo' | 'category' | 'item' = 'repo',
    public readonly categoryName?: string,
    public readonly isActive: boolean = false,
    public readonly itemStatus?: string,
    public readonly itemId?: string
  ) {
    super(label, collapsibleState);

    if (fullPath) this.resourceUri = vscode.Uri.file(fullPath);

    if (nodeType === 'repo') {
      this.contextValue = 'repository';
      this.iconPath = this.isActive 
        ? new vscode.ThemeIcon('folder-active', new vscode.ThemeColor('list.activeSelectionForeground'))
        : new vscode.ThemeIcon('folder');
      if (this.isActive) {
        this.description = 'Active';
        this.tooltip = `Active Repository: ${fullPath}`;
      } else {
        this.tooltip = `Right-click for options: ${fullPath}`;
      }
    } else if (nodeType === 'category') {
      this.contextValue = `repoCategory`;
      this.iconPath = new vscode.ThemeIcon('root-folder');
      this.tooltip = `${fullPath}/${PROJECT_CONSTANTS.SPRINTDESK_DIR}/${categoryName}`;
    } else {
      this.contextValue = 'item';
      this.iconPath = this.getStatusIcon(itemStatus);
      this.description = itemStatus || '';
      this.tooltip = `${itemId || ''} - ${itemStatus || ''}`;
      if (fullPath) {
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(fullPath)]
        };
      }
    }
  }

  private getStatusIcon(status?: string): vscode.ThemeIcon {
    switch (status?.toLowerCase()) {
      case 'done':
      case 'completed':
        return new vscode.ThemeIcon('check');
      case 'in-progress':
      case 'started':
        return new vscode.ThemeIcon('sync~spin');
      case 'blocked':
        return new vscode.ThemeIcon('error');
      case 'cancelled':
        return new vscode.ThemeIcon('close');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class RepositoriesTreeDataProvider implements vscode.TreeDataProvider<RepositoriesTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<RepositoriesTreeItem | undefined | void> = new vscode.EventEmitter<RepositoriesTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RepositoriesTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  public workspaceRoots: string[] = [];
  private excludeDirs = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.vscode', 'vendor', 'bower_components']);

  private stateService: RepositoryStateService | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(stateService?: RepositoryStateService) {
    this.stateService = stateService;
    this.updateWorkspaceRoots();

    if (this.stateService) {
      this.disposables.push(
        this.stateService.onDidChangeActiveRepo(() => {
          this.refresh();
        })
      );
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  public updateWorkspaceRoots(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.workspaceRoots = folders.map(f => f.uri.fsPath);
    } else {
      this.workspaceRoots = [];
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

    if (!element) {
      const parents = new Set<string>();

      for (const root of this.workspaceRoots) {
        try {
          await this.scanForSprintDesk(root, parents);
        } catch (err) {
          console.error('Error scanning root', root, err);
        }
      }

      const activeRepo = this.stateService?.getActiveRepo();
      const items = Array.from(parents).map(p => {
        return new RepositoriesTreeItem(
          path.basename(p) || p,
          vscode.TreeItemCollapsibleState.Collapsed,
          p,
          'repo',
          undefined,
          activeRepo === p
        );
      });

      items.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      });

      return items;
    }

    if (element.nodeType === 'repo') {
      const categories = [
        { label: 'Backlogs', key: PROJECT_CONSTANTS.BACKLOGS_DIR },
        { label: 'Epics', key: PROJECT_CONSTANTS.EPICS_DIR },
        { label: 'Sprints', key: PROJECT_CONSTANTS.SPRINTS_DIR },
        { label: 'Tasks', key: PROJECT_CONSTANTS.TASKS_DIR }
      ];

      return categories.map(c => new RepositoriesTreeItem(c.label, vscode.TreeItemCollapsibleState.Collapsed, element.fullPath, 'category', c.label));
    }

    if (element.nodeType === 'category') {
      const repoPath = element.fullPath;
      const dataService = getDataService(repoPath);
      const categoryName = element.categoryName || '';
      const items: RepositoriesTreeItem[] = [];

      if (categoryName === 'Tasks') {
        const tasks = dataService.loadTasks();
        for (const task of tasks) {
          const mdPath = dataService.getItemMdPath('task', task.id);
          items.push(new RepositoriesTreeItem(
            task.title,
            vscode.TreeItemCollapsibleState.None,
            mdPath,
            'item',
            categoryName,
            false,
            task.status,
            task.id
          ));
        }
      } else if (categoryName === 'Epics') {
        const epics = dataService.loadEpics();
        for (const epic of epics) {
          const mdPath = dataService.getItemMdPath('epic', epic.id);
          items.push(new RepositoriesTreeItem(
            epic.title,
            vscode.TreeItemCollapsibleState.None,
            mdPath,
            'item',
            categoryName,
            false,
            epic.status,
            epic.id
          ));
        }
      } else if (categoryName === 'Sprints') {
        const sprints = dataService.loadSprints();
        for (const sprint of sprints) {
          const mdPath = dataService.getItemMdPath('sprint', sprint.id);
          items.push(new RepositoriesTreeItem(
            sprint.name,
            vscode.TreeItemCollapsibleState.None,
            mdPath,
            'item',
            categoryName,
            false,
            sprint.status,
            sprint.id
          ));
        }
      } else if (categoryName === 'Backlogs') {
        const backlogs = dataService.loadBacklogs();
        for (const backlog of backlogs) {
          const mdPath = dataService.getItemMdPath('backlog', backlog.id);
          const taskCount = backlog.tasks?.length || 0;
          items.push(new RepositoriesTreeItem(
            backlog.title || backlog.name,
            vscode.TreeItemCollapsibleState.None,
            mdPath,
            'item',
            categoryName,
            false,
            `${taskCount} tasks`,
            backlog.id
          ));
        }
      }

      items.sort((a, b) => {
        const statusOrder = ['in-progress', 'started', 'upcoming', 'waiting', 'blocked', 'done', 'completed', 'cancelled'];
        const aIdx = statusOrder.indexOf(a.itemStatus?.toLowerCase() || '');
        const bIdx = statusOrder.indexOf(b.itemStatus?.toLowerCase() || '');
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      });

      return items;
    }

    return [];
  }

  private async scanForSprintDesk(startDir: string, outSet: Set<string>) {
    const stack: string[] = [startDir];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const e of entries) {
        try {
          if (e.isDirectory()) {
            if (e.name === '.SprintDesk') {
              outSet.add(dir);
              continue;
            }

            if (this.excludeDirs.has(e.name)) continue;

            stack.push(path.join(dir, e.name));
          }
        } catch (err) {
          continue;
        }
      }
    }
  }
}