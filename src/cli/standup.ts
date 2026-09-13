#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { getDataService } from '../data/DataService';
import { getStores } from '../data/stores';
import * as workforceService from '../services/workforce/workforceService';
import * as capability from '../services/workforce/capabilityService';

function resolveWorkspace(argv: string[]): string {
  const explicit = argv[2];
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);
  if (process.env.SPRINTDESK_WORKSPACE) return process.env.SPRINTDESK_WORKSPACE;
  return process.cwd();
}

function statusCounts(tasks: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

export function buildStandup(ws: string): string {
  const ds = getDataService(ws);
  const stores = getStores(ws);
  const config = ds.loadConfig();

  const tasks = ds.loadTasks();
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const unassigned = tasks.filter(t => !t.agent && t.status !== 'done' && t.status !== 'cancelled');
  const workflowActive = tasks.filter(t =>
    t.workStatus &&
    t.workStatus !== 'done' &&
    t.workStatus !== 'cancelled' &&
    t.workStatus !== 'waiting'
  );

  const runs = stores.runs.loadAll();
  const activeRuns = runs.filter(r => r.status === 'queued' || r.status === 'running');
  const recentEvents = stores.events.latest(5);

  const availability = workforceService.getWorkforceSummary();
  const byAvailability = stores.employees.loadAll().reduce<Record<string, number>>((acc, e) => {
    const k = e.status || 'idle';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  stores.skills.seedDefaultSkills();
  const skillCatalogCount = stores.skills.loadAll().length;
  const openTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const coveragePerTask = openTasks.map(t => {
    const ranked = capability.rankEmployees(
      { type: t.type, requiredSkills: t.requiredSkills },
      { includePartial: true, maxResults: 3 }
    );
    return { task: t, ranked };
  });
  const fullyMatched = coveragePerTask.filter(c => c.ranked.length > 0 && c.ranked[0].evaluation.coverage >= 1);
  const partiallyMatched = coveragePerTask.filter(
    c => c.ranked.length > 0 && c.ranked[0].evaluation.coverage < 1
  );
  const unmatched = coveragePerTask.filter(c => c.ranked.length === 0);
  const skillGaps = new Set<string>();
  for (const c of coveragePerTask) {
    for (const r of c.ranked) {
      for (const missing of r.evaluation.missing) skillGaps.add(missing);
    }
  }
  const employeesWithCertifiedSkills = stores.employees
    .loadAll()
    .filter(e => (e.skills || []).length > 0).length;

  const lines: string[] = [];
  lines.push(`# SprintDesk Standup — ${path.basename(ws)}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(`## Scope`);
  lines.push(`- Prefix: \`${config.projectPrefix}\``);
  lines.push(`- Tasks: ${tasks.length} · Epics: ${ds.loadEpics().length} · Sprints: ${ds.loadSprints().length}`);
  lines.push('');
  lines.push(`## Task Status`);
  for (const [status, count] of Object.entries(statusCounts(tasks))) {
    lines.push(`- ${status}: ${count}`);
  }
  if (workflowActive.length > 0) {
    lines.push('');
    lines.push(`## In Flight`);
    for (const t of workflowActive.slice(0, 20)) {
      lines.push(`- \`${t.code}\` ${t.title} — ${t.workStatus} — ${t.agent || 'unassigned'}`);
    }
  }
  if (inProgress.length > 0) {
    lines.push('');
    lines.push(`## In Progress`);
    for (const t of inProgress.slice(0, 20)) {
      lines.push(`- \`${t.code}\` ${t.title} — ${t.agent || 'unassigned'}`);
    }
  }
  lines.push('');
  lines.push(`## Runs`);
  if (activeRuns.length === 0) {
    lines.push(`- No active runs (${runs.length} total)`);
  } else {
    for (const r of activeRuns.slice(0, 20)) {
      lines.push(`- Run \`${r.id}\` → task \`${r.taskId}\` — ${r.status} — ${r.agentId || 'no agent'}`);
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
  lines.push(`- Open tasks: ${openTasks.length} · fully matchable: ${fullyMatched.length} · partial: ${partiallyMatched.length} · uncovered: ${unmatched.length}`);
  if (skillGaps.size > 0) {
    lines.push(`- Skill gaps: ${[...skillGaps].join(', ')}`);
  }
  for (const u of unmatched.slice(0, 5)) {
    lines.push(`  - ⚠️ uncovered: \`${u.task.code}\` ${u.task.title} (${capability.skillsForTask(u.task).join(', ')})`);
  }
  lines.push('');
  lines.push(`## Attention`);
  if (unassigned.length > 0) {
    lines.push(`- ⚠️ ${unassigned.length} open task(s) have no agent assigned — runs are gated until assigned.`);
    for (const t of unassigned.slice(0, 10)) {
      lines.push(`  - \`${t.code}\` ${t.title}`);
    }
  } else {
    lines.push(`- All open tasks are assigned.`);
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