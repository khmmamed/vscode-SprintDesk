import { Employee, EmployeeTeam, OrchestrationRole, TeamRoleAssignment } from '../../../data/types';
import { getStores } from '../../../data/stores';

export const ORCHESTRATOR_TEAM_ID = 'team_orchestrator';
export const ORCHESTRATOR_TEAM_NAME = 'Orchestrator';

// Ordered so the tree and event lifecycle read top-to-bottom.
export const ORCHESTRATION_ROLES: readonly OrchestrationRole[] = [
  'reader',
  'classifier',
  'planner',
  'organizer',
  'scheduler',
  'validator',
  'tester',
  'human-sync'
];

export const ORCHESTRATION_ROLE_LABELS: Record<OrchestrationRole, string> = {
  reader: 'Reader',
  classifier: 'Classifier',
  planner: 'Planner',
  organizer: 'Organizer',
  scheduler: 'Scheduler',
  validator: 'Validator',
  tester: 'Tester',
  ['human-sync']: 'Human Sync'
};

export const ORCHESTRATION_ROLE_DESCRIPTIONS: Record<OrchestrationRole, string> = {
  reader: 'Understands a Request (decomposition)',
  classifier: 'Assigns category / priority / execution mode',
  planner: 'Creates the Plan semantic content',
  organizer: 'Reconciles registry, dependencies & assignment',
  scheduler: 'Decides when a Plan executes',
  validator: 'Evaluates acceptance criteria after execution',
  tester: 'Runs automated verification',
  ['human-sync']: 'Human review boundary (always human-authorized)'
};

function findOrchestratorTeam(workspaceRoot?: string): EmployeeTeam | undefined {
  const teams = getStores(workspaceRoot).teams;
  return (
    teams.getById(ORCHESTRATOR_TEAM_ID) ||
    teams.loadAll().find(t => t.name.trim().toLowerCase() === ORCHESTRATOR_TEAM_NAME.toLowerCase())
  );
}

export function getOrchestratorTeam(workspaceRoot?: string): EmployeeTeam | undefined {
  return findOrchestratorTeam(workspaceRoot);
}

// Idempotently ensures the Orchestrator team exists with all eight roles. New
// roles are added unassigned; existing assignments are preserved. Returns the team.
export function seedOrchestratorTeam(workspaceRoot?: string): EmployeeTeam {
  const teams = getStores(workspaceRoot).teams;
  const now = new Date().toISOString();
  const existing = findOrchestratorTeam(workspaceRoot);

  if (!existing) {
    const team: EmployeeTeam = {
      id: ORCHESTRATOR_TEAM_ID,
      name: ORCHESTRATOR_TEAM_NAME,
      description: 'Owns the intake → plan → organize → schedule → validate stages',
      memberIds: [],
      roles: ORCHESTRATION_ROLES.map(role => ({ role })),
      createdAt: now,
      updatedAt: now
    };
    teams.add(team);
    return team;
  }

  const roles: TeamRoleAssignment[] = [...(existing.roles || [])];
  let changed = false;
  for (const role of ORCHESTRATION_ROLES) {
    if (!roles.some(r => r.role === role)) {
      roles.push({ role });
      changed = true;
    }
  }
  if (!changed) {
    return existing;
  }
  teams.update(existing.id, { roles, updatedAt: now });
  return { ...existing, roles, updatedAt: now };
}

export function roleMemberId(team: EmployeeTeam | undefined, role: OrchestrationRole): string | undefined {
  return team?.roles?.find(r => r.role === role)?.memberId;
}

// Resolves the member assigned to a role on the Orchestrator team (read-only).
export function memberForRole(role: OrchestrationRole, workspaceRoot?: string): Employee | undefined {
  const team = getOrchestratorTeam(workspaceRoot);
  const memberId = roleMemberId(team, role);
  return memberId ? getStores(workspaceRoot).people.getById(memberId) : undefined;
}

// Assigns (or clears, when memberId is empty) a role on a team. Assigning also
// adds the member to the team's membership so People → Teams reflects it.
export function assignTeamRole(
  teamId: string,
  role: OrchestrationRole,
  memberId: string | undefined,
  workspaceRoot?: string
): EmployeeTeam | undefined {
  const teams = getStores(workspaceRoot).teams;
  const team = teams.getById(teamId);
  if (!team) {
    return undefined;
  }
  const roles: TeamRoleAssignment[] = [...(team.roles || [])];
  const index = roles.findIndex(r => r.role === role);
  const next: TeamRoleAssignment = memberId ? { role, memberId } : { role };
  if (index === -1) {
    roles.push(next);
  } else {
    roles[index] = next;
  }

  const memberIds = new Set(team.memberIds);
  if (memberId) {
    memberIds.add(memberId);
  }

  teams.update(team.id, { roles, memberIds: [...memberIds], updatedAt: new Date().toISOString() });
  return { ...team, roles, memberIds: [...memberIds] };
}
