import * as vscode from 'vscode';
import { Employee, EmployeeTeam, Plan, Run } from '../../data/types';
import * as workforceService from '../../services/workforce/workforceService';
import { getStores } from '../../data/stores';
import { planTitleFor } from '../../services/workforce/plan/planService';
import type { WorkforceSection } from '../../commands/workforce/openWorkforceControlCenter';

export class WorkforceItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly employee?: Employee,
    public readonly team?: EmployeeTeam,
    public readonly run?: Run,
    public readonly plan?: Plan,
    public readonly section?: WorkforceSection,
    icon?: string,
    description?: string,
    tooltip?: string
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    if (icon) {this.iconPath = new vscode.ThemeIcon(icon);}
    if (description) {this.description = description;}
    if (tooltip) {this.tooltip = tooltip;}
    if (section) {
      this.command = {
        command: 'sprintdesk.openWorkforce',
        title: 'Open Workforce Control Center',
        arguments: [section]
      };
    }

    if (employee) {
      if (employee.role === 'agent') {
        this.iconPath = new vscode.ThemeIcon('robot');
      } else {
        this.iconPath = employee.status === 'busy'
          ? new vscode.ThemeIcon('sync~spin')
          : new vscode.ThemeIcon('account');
      }
      this.description = this.employeeDescription(employee);
      this.tooltip = this.employeeTooltip(employee);
    }
  }

  private employeeDescription(employee: Employee): string {
    const parts: string[] = [];
    parts.push(employee.role === 'agent' ? 'agent' : 'human');
    if (employee.status && employee.status !== 'idle') parts.push(employee.status);
    if (employee.capabilities && employee.capabilities.length > 0) {
      parts.push(`[${employee.capabilities.join(', ')}]`);
    }
    return parts.join(' · ');
  }

  private employeeTooltip(employee: Employee): string {
    const lines = [
      `${employee.name} (${employee.role}${employee.teamRole ? ', ' + employee.teamRole : ''})`,
      `Status: ${employee.status || 'idle'}`
    ];
    if (employee.gitAuthor) lines.push(`Git author: ${employee.gitAuthor}`);

    const certified = employee.skills?.map(s => (s.level ? `${s.name} (L${s.level})` : s.name));
    const all = [...(certified || []), ...(employee.capabilities || [])];
    if (all.length > 0) lines.push(`Skills: ${all.join(', ')}`);

    const permissions = getStores().policy.getEmployeePermissions(employee);
    lines.push(`Permissions: ${permissions.length > 0 ? permissions.join(', ') : 'none'}`);

    if (employee.description) lines.push(employee.description);
    return lines.join('\n');
  }
}

function planTitle(runPlanId: string): string {
  // v1.0 Slice D — runs execute Plans; the title comes from the Plan artifact.
  const plan = getStores().plans.getById(runPlanId);
  return planTitleFor(plan) || runPlanId;
}

function runDescription(run: Run): string {
  if (run.startedAt) {
    return `${run.status} · started ${new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return run.status;
}

function runIcon(status: Run['status']): string {
  switch (status) {
    case 'running': return 'sync~spin';
    case 'queued': return 'clock';
    case 'completed': return 'check';
    case 'failed': return 'error';
    case 'cancelled': return 'circle-slash';
  }
}

export class WorkforceTreeDataProvider implements vscode.TreeDataProvider<WorkforceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorkforceItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: WorkforceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkforceItem): Thenable<WorkforceItem[]> {
    if (!element) {
      return Promise.resolve(this.buildRootRows());
    }

    switch (element.contextValue) {
      case 'workforceTeams':
        return Promise.resolve(this.buildTeamRows());
      case 'workforceHumans':
        return Promise.resolve(this.buildPeopleRowsByRole('human'));
      case 'workforceAgents':
        return Promise.resolve(this.buildPeopleRowsByRole('agent'));
      case 'workforceTeam':
        return Promise.resolve(this.buildMemberRows(element.team));
      case 'workforceUnassigned':
        return Promise.resolve(this.buildMemberRows());
      case 'workforceRuns':
        return Promise.resolve(this.buildRunRows());
      default:
        return Promise.resolve([]);
    }
  }

  private buildRootRows(): WorkforceItem[] {
    const { employees, teams } = workforceService.getWorkforce();
    const humans = employees.filter(person => person.role === 'human').length;
    const agents = employees.filter(person => person.role === 'agent').length;
    const running = getStores().runs.loadAll().filter(r => r.status === 'running').length;

    return [
      new WorkforceItem(`Humans (${humans})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceHumans', undefined, undefined, undefined, undefined, undefined, 'account-group'),
      new WorkforceItem(`Agents (${agents})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceAgents', undefined, undefined, undefined, undefined, undefined, 'robot'),
      new WorkforceItem(`Teams (${teams.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceTeams', undefined, undefined, undefined, undefined, undefined, 'organization'),
      new WorkforceItem(`Runs (${running} running)`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceRuns', undefined, undefined, undefined, undefined, undefined, 'play')
    ];
  }

  private buildTeamRows(): WorkforceItem[] {
    const items: WorkforceItem[] = [];

    for (const resolved of workforceService.getTeamsWithMembers()) {
      const label = resolved.lead
        ? `${resolved.name} (${resolved.members.length}) · ${resolved.lead.name}`
        : `${resolved.name} (${resolved.members.length})`;
      items.push(new WorkforceItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded,
        'workforceTeam',
        undefined,
        resolved
      ));
    }

    const { unassigned } = workforceService.getWorkforce();
    if (unassigned.length > 0) {
      items.push(new WorkforceItem(
        `Unassigned (${unassigned.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'workforceUnassigned'
      ));
    }

    return items;
  }

  private buildPeopleRowsByRole(role: Employee['role']): WorkforceItem[] {
    return workforceService.getWorkforce().employees
      .filter(person => person.role === role)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(person => new WorkforceItem(
        person.name,
        vscode.TreeItemCollapsibleState.None,
        person.role === 'agent' ? 'employeeAgent' : 'employee',
        person
      ));
  }

  private buildMemberRows(team?: EmployeeTeam): WorkforceItem[] {
    if (!team) {
      return workforceService.getWorkforce().unassigned.map(
        e => new WorkforceItem(e.name, vscode.TreeItemCollapsibleState.None, e.role === 'agent' ? 'employeeAgent' : 'employee', e)
      );
    }

    return team.memberIds.map(id => {
      const employee = workforceService.getWorkforce().employees.find(e => e.id === id);
      if (!employee) return null;
      return new WorkforceItem(
        employee.name,
        vscode.TreeItemCollapsibleState.None,
        employee.role === 'agent' ? 'employeeAgent' : 'employee',
        employee
      );
    }).filter((x): x is WorkforceItem => x !== null);
  }

  private buildRunRows(): WorkforceItem[] {
    const runs = getStores().runs.loadAll()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 30);

    if (runs.length === 0) {
      return [new WorkforceItem('No runs yet', vscode.TreeItemCollapsibleState.None, 'workforceEmpty')];
    }

    return runs.map(run => {
      const employee = run.agentId ? getStores().people.getById(run.agentId) : undefined;
      const tooltip = run.error ? `${planTitle(run.planId)} - ${run.error}` : planTitle(run.planId);
      return new WorkforceItem(
        planTitle(run.planId),
        vscode.TreeItemCollapsibleState.None,
        'runItem',
        undefined,
        undefined,
        run,
        undefined,
        undefined,
        runIcon(run.status),
        `${runDescription(run)}${employee ? ` · ${employee.name}` : ''}`,
        tooltip
      );
    });
  }
}

export const workforceTreeDataProvider = new WorkforceTreeDataProvider();
