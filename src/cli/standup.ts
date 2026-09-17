#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { getStores } from '../data/stores';
import { ProposalType, Plan } from '../data/types';
import * as workforceService from '../services/workforce/workforceService';
import * as capability from '../services/workforce/capabilityService';
import { planTitleFor } from '../services/workforce/plan/planService';

const CLOSED_STATUSES = new Set(['done', 'failed', 'cancelled']);
const OPEN_SCHEDULE_STATUSES = new Set(['draft', 'ready', 'blocked', 'running']);

function resolveWorkspace(argv: string[]): string {
  const explicit = argv[2];
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);
  if (process.env.SPRINTDESK_WORKSPACE) return process.env.SPRINTDESK_WORKSPACE;
  return process.cwd();
}

function statusCounts(plans: Array<{ scheduling: { status: string } }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of plans) counts[p.scheduling.status] = (counts[p.scheduling.status] || 0) + 1;
  return counts;
}

function planCategoryToProposalType(category?: string): ProposalType {
  switch (category) {
    case 'bug': return 'bug';
    case 'maintenance': return 'chore';
    case 'documentation': return 'doc';
    case 'test': return 'test';
    case 'feature':
    case 'research':
    case 'internal':
    default:
      return 'feature';
  }
}

function planDisplay(p: Plan): { id: string; title: string; status: string; agent?: string } {
  const axis = p.classification?.current || p.classification?.original;
  return {
    id: p.id,
    title: planTitleFor(p) || p.id,
    status: p.scheduling?.status || 'draft',
    agent: p.execution?.assignedAgent || p.execution?.status
  };
}

export function buildStandup(ws: string): string {
  const stores = getStores(ws);

  const plans = stores.plans.loadAll();
  const openPlans = plans.filter(p => OPEN_SCHEDULE_STATUSES.has(p.scheduling?.status || 'draft'));
  const inFlight = plans.filter(p => p.scheduling?.status === 'running' || p.execution?.status === 'running');
  const unassigned = plans.filter(p =>
    OPEN_SCHEDULE_STATUSES.has(p.scheduling?.status || 'draft') &&
    !p.execution?.assignedAgent &&
    p.execution?.status !== 'running'
  );

  const runs = stores.runs.loadAll();
  const activeRuns = runs.filter(r => r.status === 'queued' || r.status === 'running');
  const recentEvents = stores.events.latest(5);

  const availability = workforceService.getWorkforceSummary();
  const byAvailability = stores.people.loadAll().reduce<Record<string, number>>((acc, e) => {
    const k = e.status || 'idle';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  stores.skills.seedDefaultSkills();
  const skillCatalogCount = stores.skills.loadAll().length;
  const coveragePerPlan = openPlans.map(p => {
    const axis = p.classification?.current || p.classification?.original;
    const ranked = capability.rankEmployees(
      { type: planCategoryToProposalType(axis?.category), requiredSkills: undefined },
      { includePartial: true, maxResults: 3 }
    );
    return { plan: p, ranked };
  });
  const fullyMatched = coveragePerPlan.filter(c => c.ranked.length > 0 && c.ranked[0].evaluation.coverage >= 1);
  const partiallyMatched = coveragePerPlan.filter(
    c => c.ranked.length > 0 && c.ranked[0].evaluation.coverage < 1
  );
  const unmatched = coveragePerPlan.filter(c => c.ranked.length === 0);
  const skillGaps = new Set<string>();
  for (const c of coveragePerPlan) {
    for (const r of c.ranked) {
      for (const missing of r.evaluation.missing) skillGaps.add(missing);
    }
  }
  const employeesWithCertifiedSkills = stores.people
    .loadAll()
    .filter(e => (e.skills || []).length > 0).length;

  const lines: string[] = [];
  lines.push(`# SprintDesk Standup — ${path.basename(ws)}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(`## Scope`);
  lines.push(`- Plans: ${plans.length} · Inputs: ${stores.inputs.count()} · Checkpoints: ${stores.checkpoints.count()}`);
  lines.push('');
  lines.push(`## Plan Status`);
  for (const [status, count] of Object.entries(statusCounts(plans))) {
    lines.push(`- ${status}: ${count}`);
  }
  if (inFlight.length > 0) {
    lines.push('');
    lines.push(`## In Flight`);
    for (const p of inFlight.slice(0, 20)) {
      const d = planDisplay(p);
      lines.push(`- \`${d.id}\` ${d.title} — ${d.status} — ${d.agent || 'unassigned'}`);
    }
  }
  if (openPlans.length > 0) {
    lines.push('');
    lines.push(`## Open Plans`);
    for (const p of openPlans.slice(0, 20)) {
      const d = planDisplay(p);
      lines.push(`- \`${d.id}\` ${d.title} — ${d.status} — ${d.agent || 'unassigned'}`);
    }
  }
  lines.push('');
  lines.push(`## Runs`);
  if (activeRuns.length === 0) {
    lines.push(`- No active runs (${runs.length} total)`);
  } else {
    for (const r of activeRuns.slice(0, 20)) {
      lines.push(`- Run \`${r.id}\` → plan \`${r.planId}\` — ${r.status} — ${r.agentId || 'no agent'}`);
    }
  }
  lines.push('');
  lines.push(`## Workforce`);
  lines.push(`- Employees: ${availability.employees} (${availability.agents} agents / ${availability.humans} humans)`);
  lines.push(`- Teams: ${availability.teams} · Unassigned: ${availability.unassigned}`);
  const statusLabels = Object.entries(byAvailability).map(([k, v]) => `${k}: ${v}`).join(' · ');
  lines.push(`- Availability: ${statusLabels}`);
  lines.push('');
  lines.push(`## Matching Readiness`);
  lines.push(`- Skill catalog: ${skillCatalogCount} skills · ${employeesWithCertifiedSkills} employees with certified skills`);
  lines.push(`- Open plans: ${openPlans.length} · fully matchable: ${fullyMatched.length} · partial: ${partiallyMatched.length} · uncovered: ${unmatched.length}`);
  if (skillGaps.size > 0) {
    lines.push(`- Skill gaps: ${[...skillGaps].join(', ')}`);
  }
  for (const u of unmatched.slice(0, 5)) {
    const axis = u.plan.classification?.current || u.plan.classification?.original;
    const d = planDisplay(u.plan);
    lines.push(`  - ⚠️ uncovered: \`${d.id}\` ${d.title} (${capability.skillsFor({ type: planCategoryToProposalType(axis?.category), requiredSkills: undefined }).join(', ')})`);
  }
  lines.push('');
  lines.push(`## Attention`);
  if (unassigned.length > 0) {
    lines.push(`- ⚠️ ${unassigned.length} open plan(s) have no agent assigned — runs are gated until assigned.`);
    for (const p of unassigned.slice(0, 10)) {
      const d = planDisplay(p);
      lines.push(`  - \`${d.id}\` ${d.title}`);
    }
  } else {
    lines.push(`- All open plans are assigned.`);
  }

  if (recentEvents.length > 0) {
    lines.push('');
    lines.push(`## Recent Events`);
    for (const e of recentEvents) {
      lines.push(`- [${e.type}] ${e.source} — ${new Date(e.timestamp).toLocaleString()}`);
    }
  }

  return lines.join('\n');
}

if (require.main === module) {
  const ws = resolveWorkspace(process.argv);
  const report = buildStandup(ws);
  console.log(report);
  process.exit(0);
}