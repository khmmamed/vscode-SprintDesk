import * as crypto from 'crypto';
import * as fileService from '../fileService';
import { getStores } from '../../data/stores';
import { AgentConfig, Approval, Employee, EmployeeModelProfile, EmployeeSkill, EmployeeTeam, EmployeeTeamRole } from '../../data/types';
import { getHost } from '../../host';
import { emitEvent } from './events';
import { gateMode, requestApproval } from './gates';

export interface Workforce {
  teams: EmployeeTeam[];
  employees: Employee[];
  unassigned: Employee[];
}

export interface ResolvedEmployeeTeam extends EmployeeTeam {
  members: Employee[];
  lead?: Employee;
}

export function getWorkforce(): Workforce {
  const stores = getStores();
  const teams = stores.teams.loadAll();
  const employees = stores.people.loadAll();
  const memberIds = new Set(teams.flatMap(t => t.memberIds));

  return {
    teams,
    employees,
    unassigned: employees.filter(e => !memberIds.has(e.id))
  };
}

export function getTeamsWithMembers(): ResolvedEmployeeTeam[] {
  const { teams, employees } = getWorkforce();
  return teams.map(t => ({
    ...t,
    members: employees.filter(e => t.memberIds.includes(e.id)),
    lead: employees.find(e => e.id === t.leadId)
  }));
}

export function createTeam(input: { name: string; description?: string; leadId?: string }): EmployeeTeam {
  const stores = getStores();
  const now = new Date().toISOString();
  const team: EmployeeTeam = {
    id: `team_${Date.now()}`,
    name: input.name.trim(),
    description: input.description,
    memberIds: input.leadId ? [input.leadId] : [],
    leadId: input.leadId,
    createdAt: now,
    updatedAt: now
  };
  stores.teams.add(team);
  return team;
}

export function addEmployee(input: {
  name: string;
  role: 'agent' | 'human';
  capabilities?: string[];
  status?: 'idle' | 'busy' | 'offline';
  gitAuthor?: string;
  email?: string;
  description?: string;
  teamId?: string;
  skills?: EmployeeSkill[];
  teamRole?: EmployeeTeamRole;
  agentConfig?: AgentConfig;
}): Employee {
  const stores = getStores();
  const now = new Date().toISOString();
  const employee: Employee = {
    id: `emp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    role: input.role,
    capabilities: input.capabilities || [],
    status: input.status || 'idle',
    gitAuthor: input.gitAuthor,
    email: input.email,
    description: input.description,
    skills: input.skills || [],
    teamRole: input.teamRole,
    agentConfig: input.agentConfig,
    createdAt: now,
    updatedAt: now
  };
  stores.people.add(employee);

  if (input.teamId) {
    assignToTeam(employee.id, input.teamId);
  }

  return employee;
}

export function updateEmployee(
  employeeId: string,
  updates: Partial<Pick<Employee, 'name' | 'role' | 'capabilities' | 'status' | 'gitAuthor' | 'description' | 'skills' | 'teamRole' | 'agentConfig'>>
): Employee | undefined {
  const stores = getStores();
  const existing = stores.people.getById(employeeId);
  if (!existing) return undefined;

  stores.people.update(employeeId, { ...updates, updatedAt: new Date().toISOString() });
  if (updates.status && updates.status !== existing.status) {
    emitEvent('employee.status', 'workforce', {
      employeeId,
      name: existing.name,
      from: existing.status || 'idle',
      to: updates.status
    });
    // v1.0 Slice E — agent lifecycle triggers mirror the generic status event.
    if (updates.status === 'idle') {
      emitEvent('agent.idle', 'workforce', {
        employeeId,
        name: existing.name,
        from: existing.status || 'idle'
      });
    } else if (updates.status === 'offline') {
      emitEvent('agent.offline', 'workforce', {
        employeeId,
        name: existing.name,
        from: existing.status || 'idle'
      });
    }
  }
  return stores.people.getById(employeeId);
}

export function setEmployeeStatus(
  employeeId: string,
  status: 'idle' | 'busy' | 'offline'
): Employee | undefined {
  return updateEmployee(employeeId, { status });
}

export function removeEmployee(employeeId: string): boolean {
  const stores = getStores();
  const existing = stores.people.getById(employeeId);
  if (!existing) return false;

  stores.people.delete(employeeId);

  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId) || team.leadId === employeeId) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }

  return true;
}

export function assignToTeam(employeeId: string, teamId: string): void {
  const stores = getStores();
  const employee = stores.people.getById(employeeId);
  if (!employee) throw new Error(`Employee not found: ${employeeId}`);

  const target = stores.teams.getById(teamId);
  if (!target) throw new Error(`Team not found: ${teamId}`);

  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId)) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }

  if (!target.memberIds.includes(employeeId)) {
    stores.teams.update(target.id, {
      memberIds: [...target.memberIds, employeeId],
      updatedAt: new Date().toISOString()
    });
  }
}

export function removeFromTeam(employeeId: string): void {
  const stores = getStores();
  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId) || team.leadId === employeeId) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }
}

export function setTeamLead(teamId: string, employeeId: string): EmployeeTeam | undefined {
  const stores = getStores();
  const team = stores.teams.getById(teamId);
  if (!team) throw new Error(`Team not found: ${teamId}`);

  if (employeeId && !team.memberIds.includes(employeeId)) {
    throw new Error('Lead must already be a team member');
  }

  stores.teams.update(teamId, {
    leadId: employeeId || undefined,
    updatedAt: new Date().toISOString()
  });
  return stores.teams.getById(teamId);
}

export function deleteTeam(teamId: string): boolean {
  const stores = getStores();
  if (!stores.teams.getById(teamId)) return false;
  stores.teams.delete(teamId);
  return true;
}

export async function syncPeopleFromGit(): Promise<number> {
  const stores = getStores();
  const existing = stores.people.loadAll();
  const knownEmails = new Set(existing.map(person => person.email).filter(Boolean));
  const knownAuthors = new Set(existing.map(person => person.gitAuthor || person.name).filter(Boolean));

  let added = 0;
  const now = new Date().toISOString();
  const workspaceRoot = fileService.getWorkspaceRoot();
  if (!workspaceRoot) throw new Error('No workspace found');

  const { stdout } = await getHost().exec('git log --format="%ae|%an" --all', { cwd: workspaceRoot });
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [email, name] = line.split('|');
    if (!email || !name || knownEmails.has(email) || knownAuthors.has(name)) continue;

    stores.people.add({
      id: `person_${Date.now()}_${added}`,
      name,
      email,
      role: 'human',
      status: 'idle',
      gitAuthor: name,
      description: 'Git contributor',
      skills: [],
      createdAt: now,
      updatedAt: now
    });
    knownEmails.add(email);
    knownAuthors.add(name);
    added += 1;
  }

  return added;
}

export function getWorkforceSummary(): {
  employees: number;
  agents: number;
  humans: number;
  teams: number;
  unassigned: number;
  busy: number;
} {
  const { employees, unassigned, teams } = getWorkforce();
  return {
    employees: employees.length,
    agents: employees.filter(e => e.role === 'agent').length,
    humans: employees.filter(e => e.role === 'human').length,
    teams: teams.length,
    unassigned: unassigned.length,
    busy: employees.filter(e => e.status === 'busy').length
  };
}

export function recordWorkforceAudit(entry: {
  actor: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString()
  });
}

export interface EmployeeConfigChange {
  modelProfile?: EmployeeModelProfile;
  agentConfig?: AgentConfig;
  capabilities?: string[];
}

export function performConfigChange(employeeId: string, changes: EmployeeConfigChange, requesterId?: string): Employee {
  const stores = getStores();
  const employee = stores.people.loadAll().find(e => e.id === employeeId || e.name === employeeId);
  if (!employee) throw new Error(`Employee not found: ${employeeId}`);

  const updates: Partial<Pick<Employee, 'modelProfile' | 'agentConfig' | 'capabilities'>> = {};
  if (changes.modelProfile !== undefined) updates.modelProfile = changes.modelProfile;
  if (changes.agentConfig !== undefined) updates.agentConfig = changes.agentConfig;
  if (changes.capabilities !== undefined) updates.capabilities = changes.capabilities;

  const updated = updateEmployee(employee.id, updates);
  if (!updated) throw new Error(`Employee not found: ${employeeId}`);

  recordWorkforceAudit({
    actor: requesterId || 'workforce',
    action: 'config.change',
    targetType: 'employee',
    targetId: employee.id,
    details: {
      name: employee.name,
      changed: Object.keys(updates)
    }
  });
  return updated;
}

export interface ApplyConfigResult {
  applied: boolean;
  approvalRequired?: boolean;
  employee?: Employee;
  approval?: Approval;
}

export function applyConfigChange(
  employeeId: string,
  changes: EmployeeConfigChange,
  requesterId?: string
): ApplyConfigResult {
  const employee = getStores().people.loadAll().find(e => e.id === employeeId || e.name === employeeId);
  if (!employee) {throw new Error(`Employee not found: ${employeeId}`);}

  if (gateMode('config-change') === 'manual') {
    const approval = requestApproval({
      type: 'config-change',
      reason: 'Agent configuration change requires manual approval',
      requesterId,
      target: `employee ${employee.name}`,
      pending: { op: 'apply-config', employeeId: employee.id, changes }
    });
    return { applied: false, approvalRequired: true, approval };
  }

  return { applied: true, employee: performConfigChange(employee.id, changes, requesterId) };
}
