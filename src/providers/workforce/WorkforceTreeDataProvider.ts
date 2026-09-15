import * as vscode from 'vscode';
import { Employee, EmployeeTeam, Run, Task } from '../../data/types';
import * as workforceService from '../../services/workforce/workforceService';
import { getStores } from '../../data/stores';
import { getDataService } from '../../data/DataService';
import { getWorkspaceRoot } from '../../services/fileService';
import type { WorkforceSection } from '../../commands/workforce/openWorkforceControlCenter';

export class WorkforceItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly employee?: Employee,
    public readonly team?: EmployeeTeam,
    public readonly run?: Run,
    public readonly task?: Task,
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

function dataService() {
  const ws = getWorkspaceRoot();
  return ws ? getDataService(ws) : undefined;
}

function taskTitleFor(run: Run): string {
  const ds = dataService();
  const task = ds ? ds.getTask(run.taskId) : undefined;
  return task?.title || run.taskId;
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
      return Promise.resolve(this.buildNavRows());
    }

    switch (element.contextValue) {
      case 'workforcePeople':
        return Promise.resolve(this.buildPeopleRows());
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
      case 'workforceTasks':
        return Promise.resolve(this.buildTaskRows());
      case 'workforceRuns':
        return Promise.resolve(this.buildRunRows());
      default:
        return Promise.resolve([]);
    }
  }

  private buildNavRows(): WorkforceItem[] {
    const employees = workforceService.getWorkforce().employees;
    const teams = workforceService.getWorkforce().teams;
    const pendingApprovals = getStores().approvals.loadAll().filter(a => a.status === 'pending').length;
    const pendingFindings = getStores().findings.pending().length;
    const schedules = getStores().schedules.loadAll().length;
    const workflows = getStores().workflows.loadAll().length;
    const eventRules = getStores().eventRules.loadAll();
    const eventRulesActive = eventRules.filter(r => r.enabled).length;
    const running = getStores().runs.loadAll().filter(r => r.status === 'running').length;
    const lastEvent = getStores().events.latest(1)[0];
    const assignedTasks = this.assignedTaskCount();

    return [
      new WorkforceItem(
        `People (${employees.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'workforcePeople',
        undefined, undefined, undefined, undefined, undefined,
        'organization',
        `${employees.filter(person => person.role === 'human').length} humans · ${employees.filter(person => person.role === 'agent').length} agents · ${teams.length} teams`
      ),
      new WorkforceItem(
        `Tasks (${assignedTasks})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'workforceTasks'
      ),
      new WorkforceItem(
        `Runs (${running} running)`,
        vscode.TreeItemCollapsibleState.Expanded,
        'workforceRuns'
      ),
      new WorkforceItem(
        `Findings (${pendingFindings})`,
        vscode.TreeItemCollapsibleState.None,
        'workforceFindings',
        undefined, undefined, undefined, undefined,
        'findings',
        'search',
        undefined,
        'Review workforce findings in the Control Center'
      ),
      new WorkforceItem(
        `Approvals (${pendingApprovals})`,
        vscode.TreeItemCollapsibleState.None,
        'workforceApprovals',
        undefined, undefined, undefined, undefined,
        'approvals',
        'checklist',
        undefined,
        'Manage approval gates and pending requests in the Control Center'
      ),
      new WorkforceItem(
        `Schedules (${schedules})`,
        vscode.TreeItemCollapsibleState.None,
        'workforceSchedules',
        undefined, undefined, undefined, undefined,
        'schedules',
        'calendar',
        undefined,
        'Manage schedules in the Control Center'
      ),
      new WorkforceItem(
        `Workflows (${workflows})`,
        vscode.TreeItemCollapsibleState.None,
        'workforceWorkflows',
        undefined, undefined, undefined, undefined,
        'workflows',
        'project',
        undefined,
        'Manage workflows in the Control Center'
      ),
      new WorkforceItem(
        `Event Rules (${eventRulesActive} active)`,
        vscode.TreeItemCollapsibleState.None,
        'workforceEventRules',
        undefined, undefined, undefined, undefined,
        'event-rules',
        'zap',
        undefined,
        'Automate workflows from emitted events in the Control Center'
      ),
      new WorkforceItem(
        'Activity',
        vscode.TreeItemCollapsibleState.None,
        'workforceActivity',
        undefined, undefined, undefined, undefined,
        'activity',
        'history',
        lastEvent ? new Date(lastEvent.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'no activity',
        'Open the activity feed in the Control Center'
      )
    ];
  }

  private assignedTaskCount(): number {
    const ds = dataService();
    if (!ds) {return 0;}
    const employeeIds = new Set(workforceService.getWorkforce().employees.map(e => e.id));
    return ds.loadTasks().filter(t => Boolean(t.agent) && employeeIds.has(t.agent as string)).length;
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

  private buildPeopleRows(): WorkforceItem[] {
    const { employees, teams } = workforceService.getWorkforce();
    const humans = employees.filter(person => person.role === 'human').length;
    const agents = employees.filter(person => person.role === 'agent').length;
    return [
      new WorkforceItem(`Humans (${humans})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceHumans', undefined, undefined, undefined, undefined, undefined, 'account-group'),
      new WorkforceItem(`Agents (${agents})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceAgents', undefined, undefined, undefined, undefined, undefined, 'robot'),
      new WorkforceItem(`Teams (${teams.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'workforceTeams', undefined, undefined, undefined, undefined, undefined, 'organization')
    ];
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

  private buildTaskRows(): WorkforceItem[] {
    const ds = dataService();
    if (!ds) {return [];}
    const employeeIds = new Set(workforceService.getWorkforce().employees.map(e => e.id));
    const assigned = ds.loadTasks()
      .filter(t => Boolean(t.agent) && employeeIds.has(t.agent as string))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    if (assigned.length === 0) {
      return [new WorkforceItem('No assigned tasks', vscode.TreeItemCollapsibleState.None, 'workforceEmpty')];
    }

    return assigned.map(t => new WorkforceItem(
      t.title,
      vscode.TreeItemCollapsibleState.None,
      'workforceTask',
      undefined,
      undefined,
      undefined,
      t,
      undefined,
      'checklist',
      `${t.code} · ${t.workStatus || t.status}${t.priority && t.priority !== 'medium' ? ` · ${t.priority}` : ''}`
    ));
  }

  private buildRunRows(): WorkforceItem[] {
    const runs = getStores().runs.loadAll()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 30);

    if (runs.length === 0) {
      return [new WorkforceItem('No runs yet', vscode.TreeItemCollapsibleState.None, 'workforceEmpty')];
    }

    return runs.map(run => {
      const employee = run.agentId ? getStores().employees.getById(run.agentId) : undefined;
      const tooltip = run.error ? `${taskTitleFor(run)} - ${run.error}` : taskTitleFor(run);
      return new WorkforceItem(
        taskTitleFor(run),
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
