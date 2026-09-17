import { getStores } from '../../data/stores';
import { Employee, Finding, FindingAgentReview, FindingRecommendation, FindingSeverity, FindingStatus, Run } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import { emitEvent } from './events';

export type FindingDecision = 'approved' | 'rejected';

const FINDING_HEADER = /^findings:?\s*$/i;
const ERRORS_HEADER = /^errors:?\s*$/i;
const BULLET_LINE = /^\s*[-*•]|\s*\d+[.)]\s/;
const SEVERITY_TAG = /\[(low|medium|high)\]\s*/i;

function normalizeBullet(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+?|\s*\d+[.)]\s/, '')
    .replace(SEVERITY_TAG, '')
    .trim();
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function extractFindingBullets(output?: string): Array<{ title: string; severity: FindingSeverity }> {
  const lines = (output || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const findingsIdx = lines.findIndex(l => FINDING_HEADER.test(l));
  if (findingsIdx === -1) {return [];}

  const errorsIdx = lines.findIndex((l, i) => i > findingsIdx && ERRORS_HEADER.test(l));
  const sectionEnd = errorsIdx !== -1 ? errorsIdx : lines.length;

  return lines
    .slice(findingsIdx + 1, sectionEnd)
    .filter(l => BULLET_LINE.test(l))
    .map(l => {
      const raw = normalizeBullet(l);
      const tag = l.match(SEVERITY_TAG);
      return { title: raw, severity: (tag ? tag[1].toLowerCase() : 'medium') as FindingSeverity };
    })
    .filter(b => b.title.length > 0);
}

export function findingIdentity(runId: string, bullet: { title: string; severity: FindingSeverity }): string {
  return `finding_${runId}_${hashText(`${bullet.severity}:${bullet.title}`.toLowerCase())}`;
}

export interface CreateFindingInput {
  title: string;
  runId: string;
  agent: string;
  agentName?: string;
  // v1.0 Slice D — run-produced findings link to the executed Plan.
  planId?: string;
  severity?: FindingSeverity;
  confidence?: number;
  category?: string;
  suggestedType?: Finding['suggestedType'];
  suggestedWorkflow?: string;
  suggestedPriority?: Finding['suggestedPriority'];
  evidence?: string;
  sourceType?: string;
}

export function createFinding(input: CreateFindingInput): Finding {
  const now = new Date().toISOString();
  const severity = input.severity || 'medium';
  const finding: Finding = {
    id: findingIdentity(input.runId, { title: input.title, severity }),
    title: input.title,
    source: { runId: input.runId, type: input.sourceType || 'run-output' },
    agent: input.agent,
    agentName: input.agentName,
    timestamp: now,
    severity,
    status: 'pending',
    agentValidationState: 'requested',
    agentValidationRequestedAt: now,
    ...(input.planId ? { planId: input.planId } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.suggestedType ? { suggestedType: input.suggestedType } : {}),
    ...(input.suggestedWorkflow ? { suggestedWorkflow: input.suggestedWorkflow } : {}),
    ...(input.suggestedPriority ? { suggestedPriority: input.suggestedPriority } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {})
  };

  const existing = getStores().findings.getById(finding.id);
  if (!existing) {
    getStores().findings.add(finding);
    emitEvent('finding.created', 'findings', {
      findingId: finding.id,
      runId: input.runId,
      planId: input.planId,
      agentId: input.agent,
      severity: finding.severity,
      status: finding.status
    });
    emitEvent('finding.validation.requested', 'findings', {
      findingId: finding.id,
      runId: input.runId,
      planId: input.planId,
      severity: finding.severity
    });
  }

  return getStores().findings.getById(finding.id) || finding;
}

export function materializeFindings(runId: string): Finding[] {
  const run = getStores().runs.getById(runId);
  if (!run || !run.result) {return [];}

  const employee = run.agentId ? getStores().people.getById(run.agentId) : undefined;
  const bullets = extractFindingBullets(run.result);

  return bullets.map(b => createFinding({
    title: b.title,
    severity: b.severity,
    runId: run.id,
    agent: employee?.id || run.agentId || 'unknown',
    agentName: employee?.name,
    planId: run.planId,
    evidence: b.title,
    sourceType: 'run-output'
  }));
}

export function allFindings(limit?: number): Finding[] {
  const all = getStores().findings.loadAll().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function findingsByStatus(status: FindingStatus, limit?: number): Finding[] {
  const all = getStores().findings.byStatus(status).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function pendingFindings(limit?: number): Finding[] {
  const all = getStores().findings.pending().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function pendingFindingCount(): number {
  return getStores().findings.pending().length;
}

export function updateStatus(findingId: string, decision: FindingDecision, actorId?: string): Finding | undefined {
  const finding = getStores().findings.getById(findingId);
  if (!finding || finding.status !== 'pending') {return undefined;}

  const gate = requireEmployeePermission('approval:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const now = new Date().toISOString();
  getStores().findings.update(findingId, {
    status: decision,
    resolvedAt: now,
    decisionBy: actorId
  });

  emitEvent('finding.resolved', 'findings', {
    findingId,
    runId: finding.source?.runId,
    planId: finding.planId,
    agentId: finding.agent,
    status: decision,
    decisionBy: actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: `finding.${decision}`,
    targetType: 'finding',
    targetId: findingId,
    details: { runId: finding.source?.runId, planId: finding.planId, severity: finding.severity },
    timestamp: now
  });

  return getStores().findings.getById(findingId);
}

export function linkFindingToPlan(findingId: string, planId: string): Finding | undefined {
  const finding = getStores().findings.getById(findingId);
  if (!finding) {return undefined;}
  getStores().findings.update(findingId, { planId });
  return getStores().findings.getById(findingId);
}

export function requestAgentValidation(findingId: string): Finding | undefined {
  const finding = getStores().findings.getById(findingId);
  if (!finding || finding.status !== 'pending') {return undefined;}
  if (finding.agentValidationState === 'requested') {return finding;}

  const now = new Date().toISOString();
  getStores().findings.update(findingId, {
    agentValidationState: 'requested',
    agentValidationRequestedAt: now
  });

  emitEvent('finding.validation.requested', 'findings', {
    findingId,
    runId: finding.source?.runId,
    planId: finding.planId,
    severity: finding.severity
  });

  return getStores().findings.getById(findingId);
}

export interface FindingValidationInput {
  recommendation: FindingRecommendation;
  confidence?: number;
  reason?: string;
}

export function validateFinding(findingId: string, input: FindingValidationInput, validatorId?: string): Finding | undefined {
  const finding = getStores().findings.getById(findingId);
  if (!finding || finding.status !== 'pending') {return undefined;}

  const gate = requireEmployeePermission('finding:validate', validatorId);
  if (!gate.ok) {throw new Error(gate.error);}

  // Idempotent: an already-validated finding is returned unchanged (no duplicate event/audit).
  if (finding.agentReview) {return finding;}

  const employee = validatorId ? getStores().people.getById(validatorId) : undefined;
  const now = new Date().toISOString();
  const review: FindingAgentReview = {
    validatorId: validatorId || 'system',
    validatorName: employee?.name,
    recommendation: input.recommendation,
    ...(typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? { confidence: Math.min(1, Math.max(0, input.confidence)) }
      : {}),
    ...(typeof input.reason === 'string' && input.reason.trim() ? { reason: input.reason.trim() } : {}),
    validatedAt: now
  };

  getStores().findings.update(findingId, {
    agentValidationState: 'validated',
    agentReview: review
  });

  emitEvent('finding.validated', 'findings', {
    findingId,
    runId: finding.source?.runId,
    planId: finding.planId,
    validatorId: review.validatorId,
    recommendation: review.recommendation,
    confidence: review.confidence,
    reason: review.reason
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: review.validatorId,
    action: 'finding.validated',
    targetType: 'finding',
    targetId: findingId,
    details: {
      runId: finding.source?.runId,
      planId: finding.planId,
      severity: finding.severity,
      recommendation: review.recommendation,
      confidence: review.confidence,
      reason: review.reason
    },
    timestamp: now
  });

  return getStores().findings.getById(findingId);
}

export function resolveEmployeeForRun(run: Run): Employee | undefined {
  return run.agentId ? getStores().people.getById(run.agentId) : undefined;
}

export interface FindingSummary {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export function getFindingSummary(): FindingSummary {
  const total = getStores().findings.loadAll();
  return {
    pending: total.filter(f => f.status === 'pending').length,
    approved: total.filter(f => f.status === 'approved').length,
    rejected: total.filter(f => f.status === 'rejected').length,
    total: total.length
  };
}

export interface FindingReviewCounts {
  pending: number;
  pendingAgentReview: number;
  pendingHumanReview: number;
  approved: number;
  rejected: number;
}

export function getFindingReviewCounts(): FindingReviewCounts {
  const all = getStores().findings.loadAll();
  const pending = all.filter(f => f.status === 'pending');
  return {
    pending: pending.length,
    pendingAgentReview: pending.filter(f => !f.agentReview).length,
    pendingHumanReview: pending.filter(f => !!f.agentReview).length,
    approved: all.filter(f => f.status === 'approved').length,
    rejected: all.filter(f => f.status === 'rejected').length
  };
}