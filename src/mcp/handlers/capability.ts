import { getStores } from '../../data/stores';
import * as capability from '../../services/workforce/capabilityService';
import { ProposalType } from '../../data/types';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_skillsList(args: any): HandlerResult {
  getStores().skills.seedDefaultSkills();
  const skills = getStores().skills.loadAll();
  return res(JSON.stringify(skills, null, 2));
}

function handle_sprintdesk_skillsUpsert(args: any): HandlerResult {
  getStores().skills.seedDefaultSkills();
  const existing = getStores().skills.findByName(args.name);
  const skill = {
    id: args.id || existing?.id || `skill_${Date.now()}`,
    name: args.name,
    category: args.category,
    description: args.description,
    aliases: args.aliases
  };
  getStores().skills.upsert(skill);
  return res(JSON.stringify(skill, null, 2));
}

function handle_sprintdesk_policyGet(args: any): HandlerResult {
  getStores().policy.ensureDefault();
  if (args.role) {
    return res(JSON.stringify({ role: args.role, permissions: getStores().policy.getRolePermissions(args.role) }, null, 2));
  }
  if (args.employeeId) {
    const employee = getStores().people
      .loadAll()
      .find(e => e.id === args.employeeId || e.name === args.employeeId);
    if (!employee) {
      return res(`Employee not found: ${args.employeeId}`, true);
    }
    return res(
      JSON.stringify({
        employeeId: employee.id,
        name: employee.name,
        role: employee.teamRole || employee.role,
        permissions: getStores().policy.getEmployeePermissions(employee)
      }, null, 2)
    );
  }
  const policy = getStores().policy.load();
  return res(JSON.stringify({ roles: policy.roles, overrides: policy.overrides || [] }, null, 2));
}

function handle_sprintdesk_recommendEmployees(args: any): HandlerResult {
  let spec: capability.SkillSpec | undefined;

  if (args.planId) {
    const plan = getStores().plans.getById(args.planId);
    if (!plan) return res(`Plan not found: ${args.planId}`, true);
    const axis = plan.classification?.current || plan.classification?.original;
    const type = axis?.category;
    const typeToProposal: Record<string, ProposalType> = {
      feature: 'feature',
      bug: 'bug',
      maintenance: 'chore',
      documentation: 'doc',
      test: 'test',
      research: 'feature'
    };
    const proposalType = type ? typeToProposal[type] : undefined;
    spec = { type: proposalType || 'feature', requiredSkills: args.requiredSkills };
  } else if (args.type) {
    spec = { type: args.type as ProposalType, requiredSkills: args.requiredSkills };
  } else {
    return res('Provide either planId or type', true);
  }

  const results = capability.recommendEmployees(spec, {
    includePartial: !!args.includePartial,
    maxResults: args.maxResults
  }).map(r => ({
    rank: r.rankKey,
    employeeId: r.employee.id,
    name: r.employee.name,
    role: r.employee.role,
    status: r.employee.status,
    load: r.load,
    matched: r.evaluation.matched,
    missing: r.evaluation.missing,
    coverage: r.evaluation.coverage
  }));

  return res(JSON.stringify({ spec, candidates: results }, null, 2));
}

export const WORKFORCE_HANDLERS: Record<string, Handler> = {
  sprintdesk_skillsList: handle_sprintdesk_skillsList,
  sprintdesk_skillsUpsert: handle_sprintdesk_skillsUpsert,
  sprintdesk_policyGet: handle_sprintdesk_policyGet,
  sprintdesk_recommendEmployees: handle_sprintdesk_recommendEmployees,
};