import { getStores } from '../../data/stores';
import { DEFAULT_TYPE_SKILLS } from '../../data/stores/SkillStore';
import { AuditEntry, Employee, PermissionId, Task } from '../../data/types';

export interface SkillEvaluation {
  matched: string[];
  missing: string[];
  coverage: number;
  qualifies: boolean;
}

export interface EmployeeScore {
  employee: Employee;
  evaluation: SkillEvaluation;
  load: number;
  rankKey: string;
}

export interface RecommendOptions {
  maxResults?: number;
  includePartial?: boolean;
}

export function skillsForTask(task: Pick<Task, 'type' | 'requiredSkills'>): string[] {
  if (task.requiredSkills && task.requiredSkills.length > 0) {
    return task.requiredSkills;
  }
  return DEFAULT_TYPE_SKILLS[task.type] || [];
}

export function getEffectiveSkills(employee: Employee): Map<string, number> {
  const map = new Map<string, number>();
  const catalog = getStores().skills.nameToSkill();

  const add = (name: string, level: number): void => {
    const key = name.trim().toLowerCase();
    if (!key) {
      return;
    }
    const canonical = catalog.get(key)?.name.toLowerCase() || key;
    const current = map.get(canonical) || 0;
    map.set(canonical, Math.max(current, level));
  };

  for (const skill of employee.skills || []) {
    add(skill.name, skill.level || 1);
  }

  for (const capability of employee.capabilities || []) {
    if (!map.has(capability.trim().toLowerCase())) {
      add(capability, 1);
    }
  }

  return map;
}

export function evaluate(task: Pick<Task, 'type' | 'requiredSkills'>, employee: Employee): SkillEvaluation {
  const required = skillsForTask(task);
  const effective = getEffectiveSkills(employee);

  const matched = required.filter(s => effective.has(s.toLowerCase()));
  const missing = required.filter(s => !effective.has(s.toLowerCase()));
  const coverage = required.length === 0 ? 1 : matched.length / required.length;

  return {
    matched,
    missing,
    coverage,
    qualifies: required.length === 0 || matched.length === required.length
  };
}

export function getConcurrentLoad(employee: Employee): number {
  const runs = getStores().runs.loadAll();
  return runs.filter(r => r.agentId === employee.id && (r.status === 'queued' || r.status === 'running')).length;
}

function statusRank(status: Employee['status']): number {
  return status === 'idle' ? 0 : status === 'busy' ? 1 : 2;
}

export function rankEmployees(task: Pick<Task, 'type' | 'requiredSkills'>, options: RecommendOptions = {}): EmployeeScore[] {
  const all = getStores().employees.loadAll();
  const evaluated = all
    .map(employee => {
      const evaluation = evaluate(task, employee);
      const load = getConcurrentLoad(employee);
      return { employee, evaluation, load };
    })
    .filter(s => s.employee.status !== 'offline')
    .filter(s => (options.includePartial ? s.evaluation.coverage > 0 : s.evaluation.qualifies));

  evaluated.sort((a, b) => {
    if (b.evaluation.coverage !== a.evaluation.coverage) {
      return b.evaluation.coverage - a.evaluation.coverage;
    }
    if (a.load !== b.load) {
      return a.load - b.load;
    }
    const sa = statusRank(a.employee.status);
    const sb = statusRank(b.employee.status);
    if (sa !== sb) {
      return sa - sb;
    }
    if (a.employee.name !== b.employee.name) {
      return a.employee.name < b.employee.name ? -1 : 1;
    }
    return a.employee.id < b.employee.id ? -1 : 1;
  });

  const scored: EmployeeScore[] = evaluated.map((s, index) => ({
    employee: s.employee,
    evaluation: s.evaluation,
    load: s.load,
    rankKey: `#${index + 1}`
  }));

  return scored.slice(0, options.maxResults || scored.length);
}

export function recommendEmployees(
  task: Pick<Task, 'type' | 'requiredSkills'>,
  options: RecommendOptions = {}
): EmployeeScore[] {
  const results = rankEmployees(task, options);
  recordRecommendation(task, results);
  return results;
}

export function hasEmployeePermission(employee: Employee, permission: PermissionId): boolean {
  return getStores().policy.hasPermission(employee, permission);
}

export type PermissionGate =
  | { ok: true; employee?: Employee }
  | { ok: false; error: string };

export function requireEmployeePermission(permission: PermissionId, agentIdOrName?: string): PermissionGate {
  if (!agentIdOrName) {
    return { ok: true };
  }
  const employee = getStores().employees
    .loadAll()
    .find(e => e.id === agentIdOrName || e.name === agentIdOrName);
  if (!employee) {
    return { ok: true, employee: undefined };
  }
  if (!hasEmployeePermission(employee, permission)) {
    return {
      ok: false,
      error: `Employee ${employee.name} (${employee.id}, role ${employee.teamRole || employee.role}) lacks permission '${permission}'`
    };
  }
  return { ok: true, employee };
}

function recordRecommendation(task: Pick<Task, 'type' | 'requiredSkills'>, results: EmployeeScore[]): void {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}`,
    actor: 'system',
    action: 'recommendEmployees',
    targetType: 'task',
    details: {
      taskType: task.type,
      required: skillsForTask(task),
      rankings: results.map((r, i) => ({
        rank: i + 1,
        employeeId: r.employee.id,
        name: r.employee.name,
        coverage: r.evaluation.coverage,
        load: r.load,
        status: r.employee.status
      }))
    },
    timestamp: new Date().toISOString()
  };
  getStores().audit.add(entry);
}