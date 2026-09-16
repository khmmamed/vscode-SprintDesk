import * as path from 'path';
import { getDataService } from '../../../data/DataService';
import { getHost, getFileSystem } from '../../../host';
import { getStores, Stores } from '../../../data/stores';
import { emitEvent } from '../events';
import { DEFAULT_TYPE_SKILLS } from '../../../data/stores/SkillStore';
import { rankEmployees } from '../capabilityService';
import { readPlanMd, resolvePlanFile, PlanMdSections } from './planService';
import {
  Plan,
  PlanCategory,
  PlanUrgency,
  PlanPriority,
  PlanComplexity,
  PlanRisk,
  PlanExecutionMode,
  PlanClassificationAxis,
  PlanClassificationCurrent,
  PlanOrganizationStatus,
  PlanScheduleMode,
  PlanScheduleStatus,
  PlanExecutionStatus,
  PlanAssignmentReason,
  Employee
} from '../../../data/types';

const ORGANIZER_CLASSIFIER_ID = 'organizer';
const EVENT_SOURCE = 'organizer';

function resolveRoot(workspaceRoot?: string): string {
  if (workspaceRoot) {
    return workspaceRoot;
  }
  const dataRoot = getDataService().getWorkspaceRoot();
  return (dataRoot || getHost().getWorkspaceRoot() || '') as string;
}

// ---------------------------------------------------------------------------
// Evidence classifier — deterministic keyword reconciliation over plan content.
// The Organizer never rewrites plan content; it only challenges the Orchestrator's
// `classification.original` seed with `classification.current` when evidence shows
// a different axis. Keyword lists are ordered: the FIRST matching rule for an axis
// wins, so the whole pass is a pure function of registry + artifact state.
// ---------------------------------------------------------------------------

const CATEGORY_EVIDENCE = new Map<PlanCategory, RegExp[]>([
  ['security', [/\bsecurity\b/i, /\bsecure\w*\b/i, /\bauth\b/i, /\bcredential\b/i, /\bpassword\b/i, /\btoken\b/i, /\bencrypt\w*\b/i]],
  ['bug', [/\bbug\b/i, /\bfix\w*\b/i, /\bcrash\w*\b/i, /\bexception\b/i, /\bhang\b/i, /\bdefect\b/i]],
  ['refactor', [/\brefactor\w*\b/i, /\bclean ?up\b/i, /\brestructure\w*\b/i, /\bdedupe\w*\b/i]],
  ['documentation', [/\bdocumentation\b/i, /\bdocs?\b/i, /\breadme\b/i]],
  ['test', [/\btest\b/i, /\btesting\b/i, /\bspec\b/i]],
  ['research', [/\bresearch\b/i, /\binvestigate\w*\b/i, /\bevaluate\w*\b/i, /\bexplore\w*\b/i]],
  ['data', [/\bmigrat\w*\b/i, /\bdatabase\b/i, /\bschema\b/i, /\bdataset\b/i]],
  ['maintenance', [/\bmaintenance\b/i, /\bhousekeep\w*\b/i]],
  ['infrastructure', [/\binfrastructure\b/i, /\binfra\b/i, /\bpipeline\b/i, /\bci\b/i, /\bdeploy\w*\b/i]],
  ['improvement', [/\bimprove\w*\b/i, /\benhance\w*\b/i, /\boptimize\w*\b/i]],
  ['feature', [/\bfeature\b/i, /\bimplement\w*\b/i, /\badd\b/i, /\bcapabilit\w*\b/i]]
]);

const URGENCY_EVIDENCE = new Map<PlanUrgency, RegExp[]>([
  ['emergency', [/\bemergency\b/i, /\boutage\b/i, /\basap\b/i, /\bproduction down\b/i]],
  ['urgent', [/\burgent\b/i, /\bdeadline\b/i, /\bp0\b/i]],
  ['scheduled', [/\bscheduled\b/i, /\bnext sprint\b/i, /\bbacklog\b/i]],
  ['low', [/\blow priority\b/i, /\bnice to have\b/i, /\bsomeday\b/i]]
]);

const PRIORITY_EVIDENCE = new Map<PlanPriority, RegExp[]>([
  ['critical', [/\bcritical\b/i, /\bp0\b/i, /\bdata loss\b/i]],
  ['high', [/\bhigh\b/i, /\bp1\b/i, /\burgent\b/i]],
  ['low', [/\blow\b/i, /\bp3\b/i, /\bnice to have\b/i]]
]);

const COMPLEXITY_EVIDENCE = new Map<PlanComplexity, RegExp[]>([
  ['high', [/\bcomplex\b/i, /\bcomplicated\b/i, /\bextensive\b/i, /\barchitectur\w*\b/i]],
  ['low', [/\bsimple\b/i, /\btrivial\b/i, /\bstraightforward\b/i, /\bquick\b/i]]
]);

const RISK_EVIDENCE = new Map<PlanRisk, RegExp[]>([
  ['high', [/\brisk\b/i, /\bproduction\b/i, /\bfinancial\b/i, /\blegal\b/i, /\bdeploy\w*\b/i]],
  ['low', [/\blow risk\b/i, /\bsafe\b/i, /\bisolated\b/i]]
]);

const MODE_EVIDENCE = new Map<PlanExecutionMode, RegExp[]>([
  ['scheduled', [/\bscheduled\b/i, /\bbatch\b/i, /\bnightly\b/i]],
  ['blocked', [/\bwaiting on\b/i, /\bpending\b/i, /\bblocked\b/i]],
  ['async', [/\basync\b/i, /\bbackground\b/i]],
  ['sync', [/\bsync\b/i, /\breal-?time\b/i]]
]);

const REPLANNING_EVIDENCE = [
  /\bnot feasible\b/i,
  /\bimpossible\b/i,
  /\bwrong domain\b/i,
  /\bout of scope\b/i,
  /\binvalid\b/i,
  /\bobsolete\b/i
];

export interface PlanSemantics {
  sections: PlanMdSections;
  evidence: Partial<PlanClassificationAxis>;
  axisReasons: string[];
  depIdRefs: string[];
  replanningReason?: string;
}

function normalized(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ');
}

function matchFirst(patterns: RegExp[], text: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

// Pure content analysis — no registry access, deterministic. Returns only the
// axes for which the content carries explicit evidence (never inferred defaults).
export function analyzeContent(sections: PlanMdSections): PlanSemantics {
  const text = normalized(
    [sections.objective, sections.implementation, sections.acceptanceCriteria, sections.constraints].join(' ')
  );
  const reasons: string[] = [];
  const evidence: Partial<PlanClassificationAxis> = {};

  const pick = <T extends string>(map: Map<T, RegExp[]>, axisName: string): T | undefined => {
    for (const [value, patterns] of map) {
      const hit = matchFirst(patterns, text);
      if (hit !== undefined) {
        reasons.push(`${axisName}=${value} (evidence: ${hit.trim()})`);
        return value;
      }
    }
    return undefined;
  };

  const category = pick(CATEGORY_EVIDENCE, 'category');
  if (category) {
    evidence.category = category;
  }
  const urgency = pick(URGENCY_EVIDENCE, 'urgency');
  if (urgency) {
    evidence.urgency = urgency;
  }
  const priority = pick(PRIORITY_EVIDENCE, 'priority');
  if (priority) {
    evidence.priority = priority;
  }
  const complexity = pick(COMPLEXITY_EVIDENCE, 'complexity');
  if (complexity) {
    evidence.complexity = complexity;
  }
  const risk = pick(RISK_EVIDENCE, 'risk');
  if (risk) {
    evidence.risk = risk;
  }
  const executionMode = pick(MODE_EVIDENCE, 'executionMode');
  if (executionMode) {
    evidence.executionMode = executionMode;
  }

  const refs = text.toUpperCase().match(/\bPLAN-\d{6}\b/g) || [];
  const replanHint = matchFirst(REPLANNING_EVIDENCE, text);

  return {
    sections,
    evidence,
    axisReasons: reasons,
    depIdRefs: [...new Set(refs)],
    replanningReason: replanHint || undefined
  };
}

export interface OrganizerDecision {
  kind: 'requested' | 'delayed' | 'replanning';
  planId: string;
  orgStatus: PlanOrganizationStatus;
  schedStatus: PlanScheduleStatus;
  schedMode: PlanScheduleMode;
  dependsOn: string[];
  executionStatus: PlanExecutionStatus;
  assignedAgent?: string;
  assignmentReason?: PlanAssignmentReason;
  classification?: PlanClassificationCurrent;
  reason: string;
}

function axisEqual(a: PlanClassificationAxis | undefined, b: PlanClassificationAxis | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.category === b.category &&
    a.urgency === b.urgency &&
    a.priority === b.priority &&
    a.complexity === b.complexity &&
    a.risk === b.risk &&
    a.executionMode === b.executionMode
  );
}

function currentEqual(a: PlanClassificationCurrent | undefined, b: PlanClassificationCurrent | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return axisEqual(a, b) && a.classifiedBy.type === b.classifiedBy.type && a.classifiedBy.id === b.classifiedBy.id;
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

type TaskTypeShim = 'feature' | 'bug' | 'doc' | 'test' | 'chore';

const CATEGORY_TASK_TYPE = new Map<PlanCategory, TaskTypeShim>([
  ['feature', 'feature'],
  ['bug', 'bug'],
  ['documentation', 'doc'],
  ['test', 'test'],
  ['improvement', 'chore'],
  ['refactor', 'chore'],
  ['research', 'chore'],
  ['maintenance', 'chore'],
  ['security', 'chore'],
  ['infrastructure', 'chore'],
  ['data', 'chore']
]);

function isTerminal(plan: Plan): boolean {
  if (plan.scheduling.status === 'done' || plan.scheduling.status === 'cancelled' || plan.scheduling.status === 'failed') {
    return true;
  }
  return plan.execution.status === 'running' || plan.execution.status === 'completed';
}

function depSatisfied(dep: Plan): boolean {
  return dep.execution.status === 'completed' || dep.scheduling.status === 'done';
}

// Selects an agent against the seeded people/skills directories. Plan dimensions
// map onto the existing capability ranking (category → task-type → default skills).
// The organizer records the decision; the Dispatcher (Slice E) enqueues the Run.
export function selectAgent(
  category: PlanCategory
): { agent: Employee; reason: PlanAssignmentReason } | undefined {
  const type = CATEGORY_TASK_TYPE.get(category) || 'chore';
  const [top] = rankEmployees(
    { type, requiredSkills: DEFAULT_TYPE_SKILLS[type] },
    { maxResults: 1, includePartial: false }
  );
  if (!top) {
    return undefined;
  }
  return {
    agent: top.employee,
    reason: {
      capability: top.evaluation.matched,
      availability: top.employee.status || 'idle',
      workload: top.load
    }
  };
}

function buildDecision(plan: Plan, semantics: PlanSemantics, stores: Stores, classifierId: string): OrganizerDecision {
  const planId = plan.id;
  const classifier = { type: 'agent' as const, id: classifierId };

  // 1. Replanning (fundamentally wrong) short-circuits everything.
  let replanReason: string | undefined;
  if (normalized(semantics.sections.objective.trim()).length === 0) {
    replanReason = 'objective-missing';
  } else if (semantics.replanningReason) {
    replanReason = semantics.replanningReason;
  }
  if (replanReason) {
    return {
      kind: 'replanning',
      planId,
      orgStatus: 'escalated',
      schedStatus: plan.scheduling.status,
      schedMode: plan.scheduling.mode,
      dependsOn: plan.scheduling.dependsOn,
      executionStatus: plan.execution.status,
      assignedAgent: plan.execution.assignedAgent,
      reason: `Escalated to replanning: ${replanReason}`
    };
  }

  // 2. Reconcile classification original → current when content evidence differs.
  const original = plan.classification.original;
  const base = plan.classification.current || original;
  const desired: PlanClassificationAxis = { ...original, ...semantics.evidence };
  let current: PlanClassificationCurrent | undefined;
  if (semantics.axisReasons.length > 0 && !axisEqual(desired, base)) {
    current = {
      ...desired,
      reason: semantics.axisReasons.join('; '),
      classifiedBy: classifier
    };
  } else if (plan.classification.current) {
    current = plan.classification.current;
  }

  // 3. Dependencies — registry-local PLAN-* references found in content.
  const registry = new Map(stores.plans.loadAll().map(p => [p.id, p]));
  const registryIds = new Set(registry.keys());
  const refs = semantics.depIdRefs.filter(id => id !== planId);
  const unknown = refs.filter(id => !registryIds.has(id));
  const dependsOn = refs.filter(id => registryIds.has(id)).sort();
  const depBlocked = unknown.length > 0 || (dependsOn.length > 0 && !dependsOn.every(id => depSatisfied(registry.get(id) as Plan)));

  // 4. Effective mode + scheduling readiness.
  const effectiveMode = (current || original).executionMode;
  let orgStatus: PlanOrganizationStatus = 'organized';
  let schedStatus: PlanScheduleStatus = 'ready';
  let schedMode: PlanScheduleMode = 'immediate';
  let kind: OrganizerDecision['kind'] = 'requested';
  let readinessReason = '';

  if (depBlocked) {
    orgStatus = 'blocked';
    schedStatus = 'blocked';
    schedMode = 'dependency';
    kind = 'delayed';
    readinessReason = unknown.length > 0
      ? `unknown-dependency (${unknown.join(', ')})`
      : `dependency-blocked (${dependsOn.join(', ')})`;
  } else if (effectiveMode === 'blocked') {
    orgStatus = 'blocked';
    schedStatus = 'blocked';
    schedMode = 'immediate';
    kind = 'delayed';
    readinessReason = 'execution-mode-blocked';
  } else if (effectiveMode === 'scheduled') {
    orgStatus = 'organized';
    schedStatus = 'ready';
    schedMode = 'scheduled';
    kind = 'delayed';
    readinessReason = 'scheduled-mode';
  }

  // 5. Agent selection when runnable.
  let executionStatus: PlanExecutionStatus = 'unassigned';
  let assignedAgent: string | undefined;
  let assignmentReason: PlanAssignmentReason | undefined;
  const category = (current || original).category;

  if (orgStatus === 'organized' && schedStatus === 'ready' && schedMode === 'immediate') {
    const currentAgent = plan.execution.assignedAgent ? stores.people.getById(plan.execution.assignedAgent) : undefined;
    if (currentAgent && currentAgent.status !== 'offline') {
      assignedAgent = plan.execution.assignedAgent;
      assignmentReason = plan.execution.assignmentReason;
      executionStatus = 'assigned';
      readinessReason = `ready: agent ${currentAgent.name}`;
    } else {
      const selection = selectAgent(category);
      if (selection) {
        assignedAgent = selection.agent.id;
        assignmentReason = selection.reason;
        executionStatus = 'assigned';
        readinessReason = `ready: agent ${selection.agent.name}`;
      } else {
        executionStatus = 'unassigned';
        kind = 'delayed';
        readinessReason = 'awaiting-agent';
      }
    }
  }

  const reason = [semantics.axisReasons.join('; '), readinessReason].filter(Boolean).join(' | ');

  return {
    kind,
    planId,
    orgStatus,
    schedStatus,
    schedMode,
    dependsOn,
    executionStatus,
    assignedAgent,
    assignmentReason,
    classification: current,
    reason
  };
}

function executionEqual(plan: Plan, decision: OrganizerDecision): boolean {
  return (
    plan.organization.status === decision.orgStatus &&
    plan.scheduling.status === decision.schedStatus &&
    plan.scheduling.mode === decision.schedMode &&
    listsEqual(plan.scheduling.dependsOn, decision.dependsOn) &&
    plan.execution.status === decision.executionStatus &&
    plan.execution.assignedAgent === decision.assignedAgent
  );
}

export interface PlanPassChange {
  planId: string;
  kind: OrganizerDecision['kind'];
  orgStatus: PlanOrganizationStatus;
  version: number;
  reason: string;
}

export interface OrganizeOptions {
  workspaceRoot?: string;
  classifierId?: string;
  planIds?: string[];
  // Upper bound on the number of non-terminal plans examined per pass.
  cap?: number;
}

export interface OrganizeResult {
  examined: number;
  changed: number;
  changes: PlanPassChange[];
}

export function runOrganizerPass(opts: OrganizeOptions = {}): OrganizeResult {
  const root = resolveRoot(opts.workspaceRoot);
  const stores = getStores(root);
  const classifierId = opts.classifierId || ORGANIZER_CLASSIFIER_ID;
  const now = new Date().toISOString();
  const selector = opts.planIds ? new Set(opts.planIds) : undefined;
  const cap = opts.cap;
  const plans = stores.plans.loadAll().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const changes: PlanPassChange[] = [];
  const fileSystem = getFileSystem();
  let examinedCount = 0;

  for (const plan of plans) {
    if (isTerminal(plan)) {
      continue;
    }
    if (selector && !selector.has(plan.id)) {
      continue;
    }
    if (cap !== undefined && examinedCount >= cap) {
      break;
    }
    examinedCount += 1;
    const file: string = path.join(root, '.SprintDesk', resolvePlanFile(plan));
    const semantics: PlanSemantics = fileSystem.exists(file)
      ? analyzeContent(readPlanMd(file).sections)
      : replanningSemantics('plan-content-missing');
    const decision = buildDecision(plan, semantics, stores, classifierId);
    const changed = applyDecision(plan, decision, stores, now);
    if (changed) {
      const reloaded = stores.plans.getById(plan.id);
      changes.push({
        planId: plan.id,
        kind: decision.kind,
        orgStatus: decision.orgStatus,
        version: reloaded?.organization.version ?? 0,
        reason: decision.reason
      });
    }
  }

  const passEvents = stores.events.loadAll().filter(e => e.type === 'organizer.pass.completed').length;
  const examined = examinedCount;
  emitEvent('organizer.pass.completed', EVENT_SOURCE, {
    pass: passEvents + 1,
    examined,
    changed: changes.length,
    decisions: changes.map(c => c.kind),
    at: now
  });
  return { examined, changed: changes.length, changes };
}

function replanningSemantics(reason: string): PlanSemantics {
  const empty = { objective: '', implementation: '', acceptanceCriteria: '', constraints: '' };
  return {
    sections: empty,
    evidence: {},
    axisReasons: [],
    depIdRefs: [],
    replanningReason: reason
  };
}

// Applies a decision to the registry only. Returns true when any organizational
// decision field changed (classification, scheduling, execution, org status).
// `organization.lastRunAt` advances every pass (pass bookkeeping); version,
// lastDecisionAt and decisionReason only move on an actual decision change.
function applyDecision(plan: Plan, decision: OrganizerDecision, stores: Stores, now: string): boolean {
  const classificationCurrent = decision.classification ?? plan.classification.current;
  const classificationChanged = !currentEqual(plan.classification.current, classificationCurrent);
  const executionChanged = !executionEqual(plan, decision);
  const changed = classificationChanged || executionChanged;

  const patch: Partial<Plan> = {
    classification: {
      original: plan.classification.original,
      current: classificationCurrent
    },
    scheduling: {
      ...plan.scheduling,
      status: decision.schedStatus,
      mode: decision.schedMode,
      dependsOn: decision.dependsOn
    },
    execution: {
      ...plan.execution,
      status: decision.executionStatus,
      assignedAgent: decision.assignedAgent,
      assignmentReason: decision.assignmentReason
    },
    organization: {
      ...plan.organization,
      status: decision.orgStatus,
      version: changed ? plan.organization.version + 1 : plan.organization.version,
      lastRunAt: now,
      lastDecisionAt: changed ? now : plan.organization.lastDecisionAt,
      decisionReason: changed ? decision.reason : plan.organization.decisionReason
    },
    updatedAt: changed ? now : plan.updatedAt
  };

  stores.plans.update(plan.id, patch);

  if (executionChanged) {
    const payload: Record<string, unknown> = {
      planId: plan.id,
      mode: decision.schedMode,
      reason: decision.reason
    };
    if (decision.kind === 'replanning') {
      payload.sourceInputId = plan.source.inputId;
      emitEvent('plan.replanning.requested', EVENT_SOURCE, payload);
    } else if (decision.kind === 'delayed') {
      emitEvent('plan.execution.delayed', EVENT_SOURCE, payload);
    } else {
      payload.agentId = decision.assignedAgent || undefined;
      emitEvent('plan.execution.requested', EVENT_SOURCE, payload);
    }
  }

  return changed;
}

// Dispatcher-free trigger API — event path and manual force-run share one entry.
export function triggerOrganizer(opts: OrganizeOptions = {}): OrganizeResult {
  emitEvent('organizer.trigger', EVENT_SOURCE, { at: new Date().toISOString() });
  return runOrganizerPass(opts);
}