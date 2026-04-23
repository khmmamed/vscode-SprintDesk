import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as teamService from '../../services/team/teamService';
import { TeamMember } from '../../data/types';
import { PROJECT_CONSTANTS } from '../../utils/constant';

export class TeamTreeItem extends vscode.TreeItem {
  public readonly member: TeamMember;

  constructor(
    member: TeamMember,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(member.name, collapsibleState);
    this.member = member;
    this.contextValue = member.role === 'agent' ? 'agent' : 'teamMember';

    if (member.role === 'agent') {
      this.tooltip = `${member.name}\nTool: ${member.agentConfig?.tool || 'not configured'}`;
      if (member.agentConfig?.tool === 'ollama' && member.agentConfig?.model) {
        this.tooltip += ` (${member.agentConfig.model})`;
      }
      this.iconPath = new vscode.ThemeIcon('robot');
      this.description = 'Agent';
    } else {
      this.tooltip = `${member.name} <${member.email}>\nRole: ${member.role || 'developer'}`;
      this.iconPath = new vscode.ThemeIcon('account');
      
      if (member.role === 'lead') {
        this.description = 'Lead';
      } else if (member.role === 'reviewer') {
        this.description = 'Reviewer';
      }
    }
  }
}

export class TeamTreeDataProvider implements vscode.TreeDataProvider<TeamTreeItem>, vscode.TreeDragAndDropController<TeamTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TeamTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workspaceRoot: string | undefined;

  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-team'];

  constructor() {
    this.refresh();
  }

  setWorkspaceRoot(root: string) {
    this.workspaceRoot = root;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async handleDrop(target: TeamTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!target) {
      return;
    }

    const memberId = target.member.id;
    if (!memberId) {
      vscode.window.showWarningMessage('Cannot assign: member has no ID');
      return;
    }

    const taskSources = {
      tasks: 'application/vnd.code.tree.sprintdesk-tasks',
      epics: 'application/vnd.code.tree.sprintdesk-epics',
      sprints: 'application/vnd.code.tree.sprintdesk-sprints',
      backlogs: 'application/vnd.code.tree.sprintdesk-backlogs'
    };

    for (const [source, mimeType] of Object.entries(taskSources)) {
      const item = dataTransfer.get(mimeType);
      if (item && item.value) {
        try {
          const handleData = JSON.parse(item.value as string);
          const taskId = handleData._id;
          
          if (taskId) {
            await this.handleTaskAssign(taskId, memberId);
            return;
          }
        } catch (e) {
        }
      }
    }

    const textItem = dataTransfer.get('text/plain');
    if (textItem && textItem.value) {
      try {
        const handleData = JSON.parse(textItem.value as string);
        if (handleData._id) {
          await this.handleTaskAssign(handleData._id, memberId);
          return;
        }
      } catch (e) {
      }
    }
  }

  private async handleTaskAssign(taskId: string, memberId: string): Promise<void> {
    try {
      teamService.assignTaskToMember(taskId, memberId);
      const member = teamService.getTeamMember(memberId);
      vscode.window.showInformationMessage(`Task assigned to ${member?.name || 'team member'}`);
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to assign task: ${error}`);
    }
  }

  getTreeItem(element: TeamTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TeamTreeItem): Thenable<TeamTreeItem[]> {
    if (!this.workspaceRoot) {
      const wsFolders = vscode.workspace.workspaceFolders;
      if (wsFolders && wsFolders.length > 0) {
        this.workspaceRoot = wsFolders[0].uri.fsPath;
      }
    }

    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    const members = teamService.loadTeamMembers();
    
    if (!element) {
      const items = this.groupByRole(members);
      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  private groupByRole(members: TeamMember[]): TeamTreeItem[] {
    const roleGroups: Record<string, TeamMember[]> = {
      lead: [],
      developer: [],
      reviewer: [],
      observer: [],
      agent: [],
      unassigned: []
    };

    for (const member of members) {
      const role = member.role || 'developer';
      if (!roleGroups[role]) {
        roleGroups[role] = [];
      }
      roleGroups[role].push(member);
    }

    const items: TeamTreeItem[] = [];
    
    for (const role of ['lead', 'developer', 'reviewer', 'observer', 'agent'] as const) {
      for (const member of roleGroups[role]) {
        items.push(new TeamTreeItem(member));
      }
    }

    return items;
  }

  getMembers(): TeamMember[] {
    return teamService.loadTeamMembers();
  }

  getAgents(): TeamMember[] {
    return teamService.getAgents();
  }
}

export const teamTreeDataProvider = new TeamTreeDataProvider();