import * as path from 'path';
import matter from 'gray-matter';
import { getDataService } from '../../../data/DataService';
import { getHost, getFileSystem } from '../../../host';
import { getStores } from '../../../data/stores';
import { Plan, PlanLineage } from '../../../data/types';

export interface PlanMdSections {
  objective: string;
  implementation: string;
  acceptanceCriteria: string;
  constraints: string;
}

export interface PlanMdFrontMatter {
  id: string;
  version: number;
  lineage?: PlanLineage;
}

export interface ReadPlanMdResult {
  id: string;
  version: number;
  lineage: PlanLineage;
  sections: PlanMdSections;
  raw: string;
}

const SECTION_KEYS = new Map<string, keyof PlanMdSections>([
  ['Objective', 'objective'],
  ['Implementation', 'implementation'],
  ['Acceptance Criteria', 'acceptanceCriteria'],
  ['Constraints', 'constraints']
]);

function resolveRoot(workspaceRoot?: string): string {
  if (workspaceRoot) {
    return workspaceRoot;
  }
  const dataRoot = getDataService().getWorkspaceRoot();
  return (dataRoot || getHost().getWorkspaceRoot() || '') as string;
}

export function plansDir(workspaceRoot?: string): string {
  return path.join(resolveRoot(workspaceRoot), '.SprintDesk', 'plans');
}

export function planMdPath(planId: string, workspaceRoot?: string): string {
  return path.join(plansDir(workspaceRoot), `${planId}.md`);
}

// Registry `file` reference is the author of truth for where the artifact lives
// (plans/<id>.md). Legacy/edge plans without it fall back to the id-derived path.
export function resolvePlanFile(plan: Pick<Plan, 'id' | 'file'>): string {
  return plan.file ? plan.file : `plans/${plan.id}.md`;
}

// Allocate the next sequential PLAN-#### against the persisted registry.
export function generatePlanId(workspaceRoot?: string): string {
  return getStores(workspaceRoot).plans.nextId();
}

// Orchestrator content path only — the .md body is written from source content and
// is never regenerated from registry state (no savePlanMd mirror of classification).
export function buildPlanMd(
  plan: Pick<Plan, 'id' | 'version' | 'lineage'>,
  sections: PlanMdSections
): string {
  const body = [
    `# ${plan.id}`,
    '',
    `## Objective`,
    '',
    sections.objective.trim(),
    '',
    `## Implementation`,
    '',
    sections.implementation.trim(),
    '',
    `## Acceptance Criteria`,
    '',
    sections.acceptanceCriteria.trim(),
    '',
    `## Constraints`,
    '',
    sections.constraints.trim(),
    ''
  ].join('\n');
  const data: PlanMdFrontMatter = {
    id: plan.id,
    version: plan.version,
    lineage: plan.lineage
  };
  return matter.stringify(body, data);
}

export function writePlanMd(
  plan: Pick<Plan, 'id' | 'version' | 'lineage' | 'file'>,
  sections: PlanMdSections,
  workspaceRoot?: string
): string {
  const root = resolveRoot(workspaceRoot);
  const target = path.join(root, '.SprintDesk', resolvePlanFile(plan as Plan));
  const fileSystem = getFileSystem();
  fileSystem.mkdir(path.dirname(target), { recursive: true });
  fileSystem.writeFile(target, buildPlanMd(plan, sections));
  return target;
}

export function readPlanMd(file: string): ReadPlanMdResult {
  const raw = getFileSystem().readFile(file);
  const parsed = matter(raw);
  const front = (parsed.data || {}) as PlanMdFrontMatter;
  const id = (front.id as string) || path.basename(file, '.md');
  const version = typeof front.version === 'number' ? front.version : 1;
  const lineage = (front.lineage || {}) as PlanLineage;
  return { id, version, lineage, sections: parseSections(parsed.content), raw };
}

export function parseSections(content: string): PlanMdSections {
  const sections: PlanMdSections = {
    objective: '',
    implementation: '',
    acceptanceCriteria: '',
    constraints: ''
  };
  const parts = content.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const body = (newline === -1 ? '' : part.slice(newline + 1)).trim();
    const key = SECTION_KEYS.get(heading);
    if (key) {
      sections[key] = body;
    }
  }
  return sections;
}