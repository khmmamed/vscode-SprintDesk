import { getHost } from '../../../host';
import { getStores } from '../../../data/stores';
import { Finding, PlanPriority, ProposalType, ProposalPriority, Proposal, ProposalEdit, ProposalPayload } from '../../../data/types';
import { getWorkspaceRoot } from '../../../services/fileService';
import { requireEmployeePermission } from '../capabilityService';
import { emitEvent } from '../events';
import { gateMode, requestApproval } from '../gates';
import * as findingsService from '../findingsService';
import { classifyFinding as llmClassifyFinding, ClassificationOutcome } from '../worker/classifier';
import { LLMProvider } from '../llm/types';
import { materializePlan, planTitleFor, legacyProposalKindToPlanCategory } from '../plan/planService';

export const PROPOSAL_TYPES: ProposalType[] = ['feature', 'bug', 'chore', 'doc', 'test'];
export const PROPOSAL_PRIORITIES: ProposalPriority[] = ['high', 'medium', 'low'];

export interface ProposalClassification {
  title?: string;
  type?: ProposalType;
  priority?: ProposalPriority;
  workflow?: string;
  confidence?: number;
}

export interface ResolvedClassification {
  title: string;
  type: ProposalType;
  priority: ProposalPriority;
  workflow?: string;
  confidence?: number;
  reason?: string;
}

export interface ClassificationPassResult {
  scanned: number;
  proposed: number;
  duplicates: number;
  applied: number;
  requestedApproval: number;
  failed: number;
}

function proposalRoot(): string {
  return getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
}

function severityRank(severity: Finding['severity']): number {
  return severity === 'high' ? 2 : severity === 'medium' ? 1 : 0;
}

function severityToPriority(severity: Finding['severity']): ProposalPriority {
  return severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
}

function ProposalPriorityToPlanPriority(priority: ProposalPriority): PlanPriority {
  return priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low';
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Plans with scheduling status not in {done, failed, cancelled} are "open". */
function openPlans() {
  const statuses = new Set(['done', 'failed', 'cancelled']);
  return getStores().plans.loadAll().filter(p => !statuses.has(p.scheduling.status));
}

function hasOpenPlanWithTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  const root = proposalRoot();
  return openPlans().some(p => normalizeTitle(planTitleFor(p, root) || p.id) === normalized);
}

function proposalId(): string {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hasDeterministicSuggestion(finding: Finding): boolean {
  return typeof finding.suggestedType === 'string' && PROPOSAL_TYPES.includes(finding.suggestedType);
}

export function hasProposal(findingId: string): boolean {
  return getStores().proposals.byFindingId(findingId) !== undefined;
}

export function invalidSuggestionReason(finding: Finding): string | undefined {
  if (finding.suggestedType !== undefined && !PROPOSAL_TYPES.includes(finding.suggestedType)) {
    return `invalid suggestedType '${finding.suggestedType}'`;
  }
  if (finding.suggestedPriority !== undefined && !PROPOSAL_PRIORITIES.includes(finding.suggestedPriority)) {
    return `invalid suggestedPriority '${finding.suggestedPriority}'`;
  }
  if (!hasDeterministicSuggestion(finding)) {
    return 'no usable suggestedType';
  }
  return undefined;
}

export function validateSuggestion(
  finding: Finding
): { ok: true; value: ResolvedClassification } | { ok: false; reason: string } {
  const reason = invalidSuggestionReason(finding);
  if (reason) {return { ok: false, reason };}
  return {
    ok: true,
    value: {
      title: finding.title.trim() || 'Untitled finding',
      type: finding.suggestedType as ProposalType,
      priority: finding.suggestedPriority || severityToPriority(finding.severity),
      ...(finding.suggestedWorkflow && finding.suggestedWorkflow.trim().length > 0
        ? { workflow: finding.suggestedWorkflow.trim() }
        : {})
    }
  };
}

export function createProposal(finding: Finding, classification?: ProposalClassification, proposedBy?: string, failedReason?: string): Proposal | undefined {
  const existing = getStores().proposals.byFindingId(finding.id);
  if (existing) {return existing;}

  const resolved = resolveClassification(finding, classification);

  const proposal: Proposal = {
    id: proposalId(),
    findingId: finding.id,
    runId: finding.source?.runId || '',
    agent: finding.agent,
    ...(finding.agentName ? { agentName: finding.agentName } : {}),
    title: resolved.title,
    type: resolved.type,
    priority: resolved.priority,
    ...(resolved.workflow ? { workflow: resolved.workflow } : {}),
    ...(resolved.confidence !== undefined ? { confidence: resolved.confidence } : {}),
    status: 'pending',
    ...(proposedBy ? { proposedBy } : {}),
    createdAt: new Date().toISOString(),
    ...(resolved.reason ? { reason: resolved.reason } : {})
  };

  if (resolved.reason || failedReason) {
    proposal.status = 'failed';
    proposal.reason = failedReason || resolved.reason;
  } else if (hasOpenPlanWithTitle(proposal.title)) {
    proposal.status = 'duplicate';
    proposal.reason = 'open plan with a matching title already exists';
  }

  getStores().proposals.add(proposal);

  emitEvent('proposal.created', 'classification', {
    proposalId: proposal.id,
    findingId: finding.id,
    title: proposal.title,
    type: proposal.type,
    priority: proposal.priority,
    status: proposal.status
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: proposedBy || 'system',
    action: 'classification.propose',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: finding.id, status: proposal.status },
    timestamp: proposal.createdAt
  });

  return proposal;
}

function resolveClassification(finding: Finding, classification?: ProposalClassification): ResolvedClassification {
  const validated = validateSuggestion(finding);
  if (!classification || (!classification.type && !classification.title)) {
    if (validated.ok) {return validated.value;}
    return { title: finding.title.trim() || 'Untitled finding', type: 'feature', priority: severityToPriority(finding.severity), reason: validated.reason };
  }

  const type: ProposalType | undefined =
    classification.type && PROPOSAL_TYPES.includes(classification.type) ? classification.type
    : finding.suggestedType && PROPOSAL_TYPES.includes(finding.suggestedType) ? finding.suggestedType
    : undefined;

  if (!type) {
    return { title: classification.title || finding.title, type: 'feature', priority: severityToPriority(finding.severity), reason: `invalid type '${String(classification.type)}'` };
  }

  const priority: ProposalPriority =
    classification.priority && PROPOSAL_PRIORITIES.includes(classification.priority)
      ? classification.priority
      : finding.suggestedPriority && PROPOSAL_PRIORITIES.includes(finding.suggestedPriority)
        ? finding.suggestedPriority
        : severityToPriority(finding.severity);

  return {
    title: (classification.title && classification.title.trim()) || finding.title.trim() || 'Untitled finding',
    type,
    priority,
    ...(classification.workflow && classification.workflow.trim().length > 0 ? { workflow: classification.workflow.trim() } : {}),
    ...(classification.confidence !== undefined ? { confidence: classification.confidence } : {})
  };
}

export function applyProposal(proposalIdInput: string, actorId?: string): Proposal | undefined {
  const gate = requireEmployeePermission('classification:apply', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  if (hasOpenPlanWithTitle(proposal.title)) {
    const now = new Date().toISOString();
    getStores().proposals.update(proposal.id, { status: 'duplicate', reason: 'open plan with a matching title already exists' });
    return getStores().proposals.getById(proposal.id);
  }

  const plan = materializePlan({
    sourceInputId: `proposal:${proposal.id}`,
    title: proposal.title,
    description: proposal.reason,
    category: legacyProposalKindToPlanCategory(proposal.type),
    priority: ProposalPriorityToPlanPriority(proposal.priority)
  }, { workspaceRoot: proposalRoot() });

  const now = new Date().toISOString();
  getStores().proposals.update(proposal.id, { status: 'applied', appliedPlanId: plan.id, appliedAt: now });

  findingsService.linkFindingToPlan(proposal.findingId, plan.id);
  findingsService.updateStatus(proposal.findingId, 'approved', actorId);

  emitEvent('finding.classified', 'classification', {
    proposalId: proposal.id,
    findingId: proposal.findingId,
    planId: plan.id,
    actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: 'classification.apply',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: proposal.findingId, planId: plan.id },
    timestamp: now
  });

  return getStores().proposals.getById(proposal.id);
}

export function rejectProposal(proposalIdInput: string, actorId?: string): Proposal | undefined {
  const gate = requireEmployeePermission('classification:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  const now = new Date().toISOString();
  getStores().proposals.update(proposal.id, { status: 'rejected', reason: 'rejected by review' });

  emitEvent('proposal.rejected', 'classification', {
    proposalId: proposal.id,
    findingId: proposal.findingId,
    actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: 'classification.reject',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: proposal.findingId },
    timestamp: now
  });

  return getStores().proposals.getById(proposal.id);
}

export function requeueProposal(proposalIdInput: string, actorId?: string): Proposal | undefined {
  const gate = requireEmployeePermission('classification:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}
  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'rejected') {return proposal;}

  const now = new Date().toISOString();
  getStores().proposals.update(proposal.id, { status: 'pending', reason: undefined, requeuedAt: now });

  emitEvent('proposal.requeued', 'classification', {
    proposalId: proposal.id,
    findingId: proposal.findingId,
    actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: 'classification.requeue',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: proposal.findingId },
    timestamp: now
  });

  return getStores().proposals.getById(proposal.id);
}

export interface ProposalEditChanges {
  title?: string;
  type?: string;
  priority?: string;
  workflow?: string;
}

function mergeProposalPayload(before: ProposalPayload, changes: ProposalEditChanges): ProposalPayload {
  let title = before.title;
  if (changes.title !== undefined) {
    title = changes.title.trim();
    if (title.length === 0) {throw new Error('invalid proposal title: must be non-empty');}
  }

  let type: ProposalType = before.type;
  if (changes.type !== undefined) {
    if (!PROPOSAL_TYPES.includes(changes.type as ProposalType)) {throw new Error(`invalid proposal type '${changes.type}'`);}
    type = changes.type as ProposalType;
  }

  let priority: ProposalPriority = before.priority;
  if (changes.priority !== undefined) {
    if (!PROPOSAL_PRIORITIES.includes(changes.priority as ProposalPriority)) {throw new Error(`invalid proposal priority '${changes.priority}'`);}
    priority = changes.priority as ProposalPriority;
  }

  let workflow: string | undefined = before.workflow;
  if (changes.workflow !== undefined) {
    const trimmed = changes.workflow.trim();
    workflow = trimmed.length > 0 ? trimmed : undefined;
  }

  return {
    title,
    type,
    priority,
    ...(workflow !== undefined ? { workflow } : {})
  };
}

export function editProposal(proposalIdInput: string, changes: ProposalEditChanges = {}, actorId?: string): Proposal | undefined {
  const gate = requireEmployeePermission('classification:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  const before: ProposalPayload = {
    title: proposal.title,
    type: proposal.type,
    priority: proposal.priority,
    ...(proposal.workflow ? { workflow: proposal.workflow } : {})
  };
  const after = mergeProposalPayload(before, changes);

  const now = new Date().toISOString();
  const edit: ProposalEdit = { at: now, ...(actorId ? { by: actorId } : {}), before, after };
  const edits = [...(proposal.edits || []), edit];

  getStores().proposals.update(proposal.id, {
    title: after.title,
    type: after.type,
    priority: after.priority,
    workflow: after.workflow,
    editedAt: now,
    ...(actorId ? { editedBy: actorId } : {}),
    edits
  });

  emitEvent('proposal.edited', 'classification', {
    proposalId: proposal.id,
    findingId: proposal.findingId,
    actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: 'classification.edit',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: proposal.findingId, before, after },
    timestamp: now
  });

  return getStores().proposals.getById(proposal.id);
}

export interface ClassificationPassOptions {
  limit?: number;
  actorId?: string;
  classifyWithLlm?: boolean;
  providerOverride?: LLMProvider;
}

export async function runClassificationPass(options: ClassificationPassOptions = {}): Promise<ClassificationPassResult> {
  const cap = options.limit ?? getStores().queue.getSettings().maxProposalsPerPass ?? 5;
  const useLlm = options.classifyWithLlm ?? (getStores().queue.getSettings().workerMode === 'ollama');
  const findings = findingsService
    .pendingFindings()
    .filter(f => hasDeterministicSuggestion(f) || useLlm)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.timestamp < b.timestamp ? -1 : 1));

  const result: ClassificationPassResult = { scanned: findings.length, proposed: 0, duplicates: 0, applied: 0, requestedApproval: 0, failed: 0 };
  const limit = Math.max(0, cap);

  for (const finding of findings) {
    if (result.proposed >= limit) {break;}
    if (hasProposal(finding.id)) {continue;}

    let classification: ProposalClassification | undefined;
    let failedReason: string | undefined;

    if (!hasDeterministicSuggestion(finding)) {
      const outcome: ClassificationOutcome = await llmClassifyFinding(
        finding,
        options.providerOverride ? { providerOverride: options.providerOverride } : {}
      );
      if (!outcome.ok) {
        failedReason = outcome.reason;
      } else {
        classification = outcome.value;
      }
    }

    const proposal = createProposal(finding, classification, options.actorId, failedReason);
    if (!proposal) {continue;}

    if (proposal.status === 'duplicate') {
      result.duplicates += 1;
      continue;
    }
    if (proposal.status === 'failed') {
      result.failed += 1;
      continue;
    }

    result.proposed += 1;

    if (gateMode('plan-classification') === 'auto') {
      try {
        const applied = applyProposal(proposal.id, options.actorId);
        if (applied && applied.status === 'applied') {
          result.applied += 1;
        } else if (applied && applied.status === 'duplicate') {
          result.duplicates += 1;
        }
      } catch {
        getStores().proposals.update(proposal.id, { status: 'failed' });
        result.failed += 1;
      }
    } else {
      requestApproval({
        type: 'plan-classification',
        reason: `Apply classified proposal: ${proposal.title}`,
        target: proposal.id,
        pending: { op: 'apply-proposal', proposalId: proposal.id },
        requesterId: options.actorId
      });
      result.requestedApproval += 1;
    }
  }

  return result;
}