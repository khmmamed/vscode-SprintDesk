import * as path from 'path';
import matter from 'gray-matter';
import { getWorkspaceRoot } from '../../../services/fileService';
import { getHost, getFileSystem } from '../../../host';
import { getStores, Stores } from '../../../data/stores';
import {
  Plan,
  PlanCategory,
  PlanClassificationAxis,
  PlanComplexity,
  PlanExecutionMode,
  PlanLineage,
  PlanPriority,
  PlanRisk,
  PlanUrgency
} from '../../../data/types';

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
  return getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
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

// Human-facing plan title: the md Objective section of the authoritative artifact,
// falling back to the plan id when the file is missing or has no Objective.
export function planTitleFor(plan: Plan | undefined, workspaceRoot?: string): string | undefined {
  if (!plan) {return undefined;}
  const root = resolveRoot(workspaceRoot);
  const file = root ? path.join(root, '.SprintDesk', resolvePlanFile(plan)) : '';
  if (file && getFileSystem().exists(file)) {
    const md = readPlanMd(file);
    return md.sections.objective || plan.id;
  }
  return plan.id;
}

// Allocate the next sequential PLAN-#### against the persisted registry.
export function generatePlanId(workspaceRoot?: string): string {
  return getStores(workspaceRoot).plans.nextId();
}

// v1.0 Slice D — internal (non-Orchestrator) plan materialization used by the
// queue's plan producers (scheduler, workflow engine, control center). Writes the
// plan artifact and seeds classification.original like the Orchestrator, but the
// plan is immediately runnable (scheduling ready / execution unassigned) and is
// NOT routed through the Orchestrator lifecycle (no inputs record, no cycle).
const DEFAULT_PLAN_AXIS: PlanClassificationAxis = {
  category: 'feature',
  urgency: 'normal',
  priority: 'medium',
  complexity: 'medium',
  risk: 'medium',
  executionMode: 'immediate'
};

export interface MaterializePlanInput {
  sourceInputId: string;
  title: string;
  description?: string;
  category?: PlanCategory;
  urgency?: PlanUrgency;
  priority?: PlanPriority;
  complexity?: PlanComplexity;
  risk?: PlanRisk;
  executionMode?: PlanExecutionMode;
}

// Maps the residual legacy task-kind vocabulary (Task.type / ScheduleTaskTemplate.type)
// onto the Plan classification axis.
export type LegacyTaskKind = 'feature' | 'bug' | 'chore' | 'doc' | 'test';

export function legacyTaskKindToPlanCategory(kind: LegacyTaskKind): PlanCategory {
  switch (kind) {
    case 'feature': return 'feature';
    case 'bug': return 'bug';
    case 'chore': return 'maintenance';
    case 'doc': return 'documentation';
    case 'test': return 'test';
  }
}

export function materializePlan(
  input: MaterializePlanInput,
  opts: { workspaceRoot?: string; stores?: Stores } = {}
): Plan {
  const stores = opts.stores || getStores(opts.workspaceRoot);
  const now = new Date().toISOString();
  const id = stores.plans.nextId();
  const plan: Plan = {
    id,
    file: `plans/${id}.md`,
    version: 1,
    lineage: {},
    source: { inputId: input.sourceInputId },
    organization: { status: 'pending', version: 0 },
    classification: {
      original: {
        ...DEFAULT_PLAN_AXIS,
        ...(input.category ? { category: input.category } : {}),
        ...(input.urgency ? { urgency: input.urgency } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.complexity ? { complexity: input.complexity } : {}),
        ...(input.risk ? { risk: input.risk } : {}),
        ...(input.executionMode ? { executionMode: input.executionMode } : {})
      }
    },
    scheduling: { status: 'ready', mode: 'immediate', dependsOn: [] },
    execution: { status: 'unassigned' },
    validation: { decision: 'passed', errors: [], artifacts: [] },
    createdAt: now,
    updatedAt: now
  };
  stores.plans.add(plan);
  const root = opts.workspaceRoot || resolveRoot();
  writePlanMd(
    plan,
    {
      objective: input.title,
      implementation: input.description || '',
      acceptanceCriteria: '',
      constraints: ''
    },
    root
  );
  return plan;
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