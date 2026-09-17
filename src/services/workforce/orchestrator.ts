import * as path from 'path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { getWorkspaceRoot } from '../fileService';
import { getHost, getFileSystem } from '../../host';
import { getStores, Stores } from '../../data/stores';
import {
  EmployeeModelProfile,
  InputRecord,
  InputSource,
  Plan,
  PlanCategory,
  PlanClassificationAxis,
  PlanComplexity,
  PlanExecutionMode,
  PlanPriority,
  PlanRisk,
  PlanUrgency,
  Cycle
} from '../../data/types';
import { emitEvent } from './events';
import { getLLMProvider } from './llm/registry';
import { LLMProvider, ProviderRequest } from './llm/types';
import { readPlanMd, resolvePlanFile, writePlanMd, PlanMdSections } from './plan/planService';

const PLAN_CATEGORIES: readonly string[] = [
  'feature', 'bug', 'improvement', 'refactor', 'research', 'documentation',
  'test', 'maintenance', 'security', 'infrastructure', 'data'
];
const PLAN_URGENCIES: readonly string[] = ['emergency', 'urgent', 'normal', 'low', 'scheduled'];
const PLAN_PRIORITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];
const PLAN_OBJECT_LEVELS: readonly string[] = ['low', 'medium', 'high'];
const PLAN_EXECUTION_MODES: readonly string[] = ['immediate', 'async', 'sync', 'scheduled', 'blocked'];

// v1.0 Slice B — Orchestrator seed classification defaults (registry defaults).
// The Organizer (Slice C) may correct these into classification.current; the
// Orchestrator only ever writes classification.original.
const DEFAULT_PLAN_AXIS: PlanClassificationAxis = {
  category: 'feature',
  urgency: 'normal',
  priority: 'medium',
  complexity: 'medium',
  risk: 'medium',
  executionMode: 'immediate'
};

const EVENT_SOURCE = 'orchestrator';

// A single decomposition unit — the Orchestrator's content unit that becomes one plan.
export interface OrchestrationUnit {
  title: string;
  objective: string;
  implementation?: string;
  acceptanceCriteria?: string;
  constraints?: string;
  classification?: Partial<PlanClassificationAxis>;
}

export interface OrchestrateOptions {
  // LLM path (optional). Decomposition suggestions are always re-entered through
  // the deterministic createPlan content path and stay bounded by the pass cap.
  providerOverride?: LLMProvider;
  modelProfile?: EmployeeModelProfile;
  maxPlansPerPass?: number;
  workspaceRoot?: string;
}

export interface IngestOptions {
  source?: InputSource;
  workspaceRoot?: string;
}

export interface DiscoveredInput {
  path: string;
  name: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
}

export interface SkippedPlan {
  title: string;
  reason: 'duplicate' | 'cap' | string;
}

export interface OrchestrateResult {
  input: InputRecord;
  cycleId: string;
  plans: Plan[];
  skipped: SkippedPlan[];
}

function resolveRoot(workspaceRoot?: string): string {
  if (workspaceRoot) {
    return workspaceRoot;
  }
  return getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
}

export function inputsDir(workspaceRoot?: string): string {
  return path.join(resolveRoot(workspaceRoot), '.SprintDesk', 'inputs');
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

export function normalizeText(text: string): string {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function pickAxis(source: Record<string, unknown>): Partial<PlanClassificationAxis> {
  const axis: Partial<PlanClassificationAxis> = {};
  if (typeof source.category === 'string' && PLAN_CATEGORIES.includes(source.category)) {
    axis.category = source.category as PlanCategory;
  }
  if (typeof source.urgency === 'string' && PLAN_URGENCIES.includes(source.urgency)) {
    axis.urgency = source.urgency as PlanUrgency;
  }
  if (typeof source.priority === 'string' && PLAN_PRIORITIES.includes(source.priority)) {
    axis.priority = source.priority as PlanPriority;
  }
  if (typeof source.complexity === 'string' && PLAN_OBJECT_LEVELS.includes(source.complexity)) {
    axis.complexity = source.complexity as PlanComplexity;
  }
  if (typeof source.risk === 'string' && PLAN_OBJECT_LEVELS.includes(source.risk)) {
    axis.risk = source.risk as PlanRisk;
  }
  if (typeof source.executionMode === 'string' && PLAN_EXECUTION_MODES.includes(source.executionMode)) {
    axis.executionMode = source.executionMode as PlanExecutionMode;
  }
  return axis;
}

function firstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function stripFirstHeading(content: string): string {
  return content.replace(/^#\s+.+\s*/m, '').trim();
}

function firstParagraph(content: string): string {
  const cleaned = stripFirstHeading(content);
  const paragraph = cleaned.split(/\n{2,}/)[0] || '';
  return paragraph.trim();
}

// Deterministic decomposition: front-matter drives the units. A `plans` array
// yields one plan per entry; otherwise a single plan is derived from the whole
// input (title/objective from front-matter or the first heading/paragraph).
function deterministicallyDecompose(
  data: Record<string, unknown>,
  content: string,
  fileName: string
): OrchestrationUnit[] {
  const rawPlans = Array.isArray(data.plans) ? data.plans : Array.isArray(data.units) ? data.units : undefined;
  if (rawPlans && rawPlans.length > 0) {
    const units: OrchestrationUnit[] = [];
    for (const entry of rawPlans) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const title = asString(record.title) || asString(record.objective) || 'Untitled plan';
      const objective = asString(record.objective) || asString(record.title) || '';
      if (!objective) {
        continue;
      }
      units.push({
        title,
        objective,
        implementation: asString(record.implementation) || '',
        acceptanceCriteria: asString(record.acceptanceCriteria) || '',
        constraints: asString(record.constraints) || '',
        classification: pickAxis(record)
      });
    }
    return units;
  }

  const objective = asString(data.objective);
  if (!objective) {
    return [];
  }
  return [
    {
      title: asString(data.title) || asString(data.name) || firstHeading(content) || path.basename(fileName, '.md'),
      objective,
      implementation: asString(data.implementation) || firstParagraph(content),
      acceptanceCriteria: asString(data.acceptanceCriteria) || '',
      constraints: asString(data.constraints) || '',
      classification: pickAxis(data)
    }
  ];
}

const DECOMPOSE_SYSTEM_PROMPT = [
  'You are an orchestrator decomposing a work input into plan units.',
  'Respond with a single JSON array only, of the shape:',
  '[{"title": string, "objective": string, "implementation": string (optional), "acceptanceCriteria": string (optional), "constraints": string (optional), "category": "feature"|"bug"|"improvement"|"refactor"|"research"|"documentation"|"test"|"maintenance"|"security"|"infrastructure"|"data" (optional), "urgency": "emergency"|"urgent"|"normal"|"low"|"scheduled" (optional), "priority": "critical"|"high"|"medium"|"low" (optional), "complexity": "low"|"medium"|"high" (optional), "risk": "low"|"medium"|"high" (optional), "executionMode": "immediate"|"async"|"sync"|"scheduled"|"blocked" (optional)}].',
  'Every unit must carry at least a title and an objective.',
  'Do not include any text outside the JSON array.'
].join(' ');

function parseDecomposition(output: string): OrchestrationUnit[] | undefined {
  const cleaned = output.replace(/```(?:json)?/gi, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const units: OrchestrationUnit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const title = asString(record.title);
    const objective = asString(record.objective);
    if (!objective && !title) {
      continue;
    }
    units.push({
      title: title || (objective as string).slice(0, 80),
      objective: objective || (title as string),
      implementation: asString(record.implementation) || '',
      acceptanceCriteria: asString(record.acceptanceCriteria) || '',
      constraints: asString(record.constraints) || '',
      classification: pickAxis(record)
    });
  }
  return units.length > 0 ? units : undefined;
}

// LLM path — decomposition suggestions only. Any failure or malformed output
// falls back to deterministic decomposition; plans are still created through
// the content path under the cap.
async function suggestDecomposition(raw: string, opts: OrchestrateOptions): Promise<OrchestrationUnit[] | undefined> {
  const provider = opts.providerOverride || (opts.modelProfile ? getLLMProvider(opts.modelProfile) : undefined);
  if (!provider) {
    return undefined;
  }
  const request: ProviderRequest = {
    model: opts.modelProfile?.model || 'planner',
    messages: [
      { role: 'system', content: DECOMPOSE_SYSTEM_PROMPT },
      { role: 'user', content: raw }
    ],
    baseUrl: opts.modelProfile?.baseUrl,
    temperature: opts.modelProfile?.options?.temperature
  };
  try {
    const response = await provider.chat(request);
    const output = (response.text || '').trim();
    if (!output) {
      return undefined;
    }
    return parseDecomposition(output);
  } catch {
    return undefined;
  }
}

// Finds the open cycle for an input, creating one when needed. Idempotent —
// reorchestrating reuses the same cycle.
function openCycleForInput(stores: Stores, inputId: string): Cycle {
  const existing = stores.cycles.open().find(c => c.inputIds.includes(inputId));
  if (existing) {
    return existing;
  }
  const cycle: Cycle = {
    id: stores.cycles.nextId(),
    inputIds: [inputId],
    planIds: [],
    executionIds: [],
    organizationPasses: 0,
    startedAt: new Date().toISOString(),
    outcome: 'open'
  };
  stores.cycles.add(cycle);
  emitEvent('cycle.opened', EVENT_SOURCE, { cycleId: cycle.id, inputId });
  return cycle;
}

function existingPlanObjectives(root: string): Set<string> {
  const stores = getStores(root);
  const fileSystem = getFileSystem();
  const objectives = new Set<string>();
  for (const plan of stores.plans.loadAll()) {
    const file = path.join(root, '.SprintDesk', resolvePlanFile(plan));
    try {
      if (fileSystem.exists(file)) {
        objectives.add(normalizeText(readPlanMd(file).sections.objective));
      }
    } catch {
      // unreadable plan artifact — ignore for dedup
    }
  }
  return objectives;
}

// Orchestrator content path — writes plans/PLAN-*.md + seeds classification.original.
// Never writes classification.current (the Organizer owns that).
export function createPlan(
  inputId: string,
  unit: OrchestrationUnit,
  opts: { workspaceRoot?: string } = {}
): Plan {
  const root = resolveRoot(opts.workspaceRoot);
  const stores = getStores(root);
  const now = new Date().toISOString();
  const id = stores.plans.nextId();
  const plan: Plan = {
    id,
    file: `plans/${id}.md`,
    version: 1,
    lineage: {},
    source: { inputId },
    organization: { status: 'pending', version: 0 },
    classification: { original: { ...DEFAULT_PLAN_AXIS, ...unit.classification } },
    scheduling: { status: 'draft', mode: 'immediate', dependsOn: [] },
    execution: { status: 'unassigned' },
    validation: { decision: 'passed', errors: [], artifacts: [] },
    createdAt: now,
    updatedAt: now
  };
  stores.plans.add(plan);

  const sections: PlanMdSections = {
    objective: unit.objective,
    implementation: unit.implementation || '',
    acceptanceCriteria: unit.acceptanceCriteria || '',
    constraints: unit.constraints || ''
  };
  const written = writePlanMd(plan, sections, root);

  const cycle = openCycleForInput(stores, inputId);
  if (!cycle.planIds.includes(id)) {
    stores.cycles.update(cycle.id, { planIds: [...cycle.planIds, id] });
  }

  emitEvent('plan.created', EVENT_SOURCE, { planId: id, inputId, version: plan.version, file: written });
  return plan;
}

// Discovers inputs/*.md not yet registered in the InputStore. Dedup is by
// file name + content hash (mtime is surfaced for callers that need it), so an
// edited file is treated as a new input rather than silently skipped.
export function listInputs(workspaceRoot?: string): DiscoveredInput[] {
  const root = resolveRoot(workspaceRoot);
  const stores = getStores(root);
  const fileSystem = getFileSystem();
  const dir = inputsDir(root);
  if (!fileSystem.exists(dir)) {
    return [];
  }
  const registered = stores.inputs.loadAll();
  const deduped = new Map<string, Set<string>>();
  for (const record of registered) {
    const name = path.basename(record.file.replace(/\\/g, '/'));
    const hashes = deduped.get(name) || new Set<string>();
    if (record.contentHash) {
      hashes.add(record.contentHash);
    }
    deduped.set(name, hashes);
  }

  const discovered: DiscoveredInput[] = [];
  for (const name of fileSystem.list(dir)) {
    if (!name.toLowerCase().endsWith('.md')) {
      continue;
    }
    const abs = path.join(dir, name);
    try {
      const content = fileSystem.readFile(abs);
      const stat = fileSystem.stat(abs);
      const hash = sha1(content);
      const hashes = deduped.get(name);
      if (hashes && (hashes.size === 0 || hashes.has(hash))) {
        continue;
      }
      discovered.push({ path: abs, name, contentHash: hash, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // unreadable file — skip it
    }
  }
  return discovered;
}

// Registers an input artifact (Basket 1) and opens its lifecycle cycle.
export function ingestInput(file: string, opts: IngestOptions = {}): InputRecord {
  const root = resolveRoot(opts.workspaceRoot);
  const stores = getStores(root);
  const fileSystem = getFileSystem();
  const abs = path.isAbsolute(file) ? file : path.join(root, '.SprintDesk', 'inputs', file);
  const name = path.basename(abs);
  const content = fileSystem.readFile(abs);
  const hash = sha1(content);

  const existing = stores.inputs
    .loadAll()
    .find(r => r.file.replace(/\\/g, '/') === `inputs/${name}` && r.contentHash === hash);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const input: InputRecord = {
    id: stores.inputs.nextId(),
    file: `inputs/${name}`,
    status: 'new',
    source: opts.source ? { type: opts.source.type, id: opts.source.id } : { type: 'human' },
    ingestedAt: now,
    plannedFrom: [],
    contentHash: hash
  };
  stores.inputs.add(input);
  emitEvent('input.created', EVENT_SOURCE, { inputId: input.id, file: input.file });
  openCycleForInput(stores, input.id);
  return input;
}

// Runs an Orchestrator pass for one input: decompose → dedup → bound → create plans.
// Idempotent per input (plans deduped by normalized objective) and capped by
// maxPlansPerPass (queue settings, default 5).
export async function orchestrate(inputId: string, opts: OrchestrateOptions = {}): Promise<OrchestrateResult> {
  const root = resolveRoot(opts.workspaceRoot);
  const stores = getStores(root);
  const fileSystem = getFileSystem();
  const input = stores.inputs.getById(inputId);
  if (!input) {
    throw new Error(`unknown input: ${inputId}`);
  }
  const abs = path.join(root, '.SprintDesk', input.file);
  if (!fileSystem.exists(abs)) {
    throw new Error(`input file missing: ${input.file}`);
  }
  const raw = fileSystem.readFile(abs);
  const parsed = matter(raw);
  const data = (parsed.data || {}) as Record<string, unknown>;

  const suggested = await suggestDecomposition(raw, opts);
  const units = suggested ? suggested : deterministicallyDecompose(data, parsed.content, input.file);

  const existing = existingPlanObjectives(root);
  const cap = opts.maxPlansPerPass ?? stores.queue.getSettings().maxPlansPerPass ?? 5;
  const accepted: OrchestrationUnit[] = [];
  const skipped: SkippedPlan[] = [];
  for (const unit of units) {
    const objectiveKey = normalizeText(unit.objective);
    if (objectiveKey && existing.has(objectiveKey)) {
      skipped.push({ title: unit.title, reason: 'duplicate' });
      continue;
    }
    if (accepted.length >= cap) {
      skipped.push({ title: unit.title, reason: 'cap' });
      continue;
    }
    accepted.push(unit);
    existing.add(objectiveKey);
  }

  const cycle = openCycleForInput(stores, inputId);
  const plans: Plan[] = [];
  for (const unit of accepted) {
    plans.push(createPlan(inputId, unit, { workspaceRoot: root }));
  }

  if (plans.length > 0) {
    const plannedFrom = [...(input.plannedFrom || [])];
    for (const plan of plans) {
      if (!plannedFrom.includes(plan.id)) {
        plannedFrom.push(plan.id);
      }
    }
    stores.inputs.update(inputId, { plannedFrom, status: 'planned' });
    emitEvent('input.planned', EVENT_SOURCE, { inputId, planIds: plans.map(p => p.id) });
  }

  const reloaded = stores.inputs.getById(inputId);
  return {
    input: reloaded || input,
    cycleId: cycle.id,
    plans,
    skipped
  };
}

// Exposed for the Control Center / MCP surface (Slice H) — resolves an input's
// artifact path so callers can show the source markdown.
export function inputArtifactPath(inputId: string, workspaceRoot?: string): string {
  const root = resolveRoot(workspaceRoot);
  const input = getStores(root).inputs.getById(inputId);
  if (!input) {
    return '';
  }
  return path.join(root, '.SprintDesk', input.file);
}

export function planObjective(planId: string, workspaceRoot?: string): string {
  const root = resolveRoot(workspaceRoot);
  const plan = getStores(root).plans.getById(planId);
  if (!plan) {
    return '';
  }
  const file = path.join(root, '.SprintDesk', resolvePlanFile(plan));
  if (!getFileSystem().exists(file)) {
    return '';
  }
  return readPlanMd(file).sections.objective;
}