import { getDataService } from '../../../data/DataService';
import { getHost } from '../../../host';
import { getStores } from '../../../data/stores';
import { Finding, Task, TaskProposal, TaskProposalEdit, TaskProposalTaskPayload } from '../../../data/types';
import { getTaskService } from '../../taskService';
import { requireEmployeePermission } from '../capabilityService';
import { emitEvent } from '../events';
import { gateMode, requestApproval } from '../gates';
import * as findingsService from '../findingsService';
import { classifyFinding as llmClassifyFinding, ClassificationOutcome } from '../worker/classifier';
import { LLMProvider } from '../llm/types';

export const TASK_TYPES: Task['type'][] = ['feature', 'bug', 'chore', 'doc', 'test'];
export const TASK_PRIORITIES: Task['priority'][] = ['high', 'medium', 'low'];

export interface ProposalClassification {
  title?: string;
  type?: Task['type'];
  priority?: Task['priority'];
  workflow?: string;
  confidence?: number;
}

export interface ResolvedClassification {
  title: string;
  type: Task['type'];
  priority: Task['priority'];
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
  return getDataService().getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
}

function taskSvc() { return getTaskService(proposalRoot()); }

function severityRank(severity: Finding['severity']): number {
  return severity === 'high' ? 2 : severity === 'medium' ? 1 : 0;
}

function severityToPriority(severity: Finding['severity']): Task['priority'] {
  return severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

function openTasks(): Task[] {
  return taskSvc().loadTasks().filter(t => t.status !== 'done' && t.status !== 'cancelled');
}

function hasOpenTaskWithTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  return openTasks().some(t => normalizeTitle(t.title) === normalized);
}

function proposalId(): string {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hasDeterministicSuggestion(finding: Finding): boolean {
  return typeof finding.suggestedTaskType === 'string' && TASK_TYPES.includes(finding.suggestedTaskType as Task['type']);
}

export function hasProposal(findingId: string): boolean {
  return getStores().proposals.byFindingId(findingId) !== undefined;
}

export function invalidSuggestionReason(finding: Finding): string | undefined {
  if (finding.suggestedTaskType !== undefined && !TASK_TYPES.includes(finding.suggestedTaskType as Task['type'])) {
    return `invalid suggestedTaskType '${finding.suggestedTaskType}'`;
  }
  if (finding.suggestedPriority !== undefined && !TASK_PRIORITIES.includes(finding.suggestedPriority as Task['priority'])) {
    return `invalid suggestedPriority '${finding.suggestedPriority}'`;
  }
  if (!hasDeterministicSuggestion(finding)) {
    return 'no usable suggestedTaskType';
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
      type: finding.suggestedTaskType as Task['type'],
      priority: finding.suggestedPriority || severityToPriority(finding.severity),
      ...(finding.suggestedWorkflow && finding.suggestedWorkflow.trim().length > 0
        ? { workflow: finding.suggestedWorkflow.trim() }
        : {})
    }
  };
}

export function createProposal(finding: Finding, classification?: ProposalClassification, proposedBy?: string, failedReason?: string): TaskProposal | undefined {
  const existing = getStores().proposals.byFindingId(finding.id);
  if (existing) {return existing;}

  const resolved = resolveClassification(finding, classification);

  const proposal: TaskProposal = {
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
  } else if (hasOpenTaskWithTitle(proposal.title)) {
    proposal.status = 'duplicate';
    proposal.reason = 'open task with a matching title already exists';
  }

  getStores().proposals.add(proposal);

  emitEvent('task.proposal.created', 'classification', {
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

  const type: Task['type'] | undefined =
    classification.type && TASK_TYPES.includes(classification.type) ? classification.type
    : finding.suggestedTaskType && TASK_TYPES.includes(finding.suggestedTaskType as Task['type']) ? (finding.suggestedTaskType as Task['type'])
    : undefined;

  if (!type) {
    return { title: classification.title || finding.title, type: 'feature', priority: severityToPriority(finding.severity), reason: `invalid type '${String(classification.type)}'` };
  }

  const priority: Task['priority'] =
    classification.priority && TASK_PRIORITIES.includes(classification.priority)
      ? classification.priority
      : finding.suggestedPriority && TASK_PRIORITIES.includes(finding.suggestedPriority as Task['priority'])
        ? (finding.suggestedPriority as Task['priority'])
        : severityToPriority(finding.severity);

  return {
    title: (classification.title && classification.title.trim()) || finding.title.trim() || 'Untitled finding',
    type,
    priority,
    ...(classification.workflow && classification.workflow.trim().length > 0 ? { workflow: classification.workflow.trim() } : {}),
    ...(classification.confidence !== undefined ? { confidence: classification.confidence } : {})
  };
}

export function applyProposal(proposalIdInput: string, actorId?: string): TaskProposal | undefined {
  const gate = requireEmployeePermission('classification:apply', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  if (hasOpenTaskWithTitle(proposal.title)) {
    const now = new Date().toISOString();
    getStores().proposals.update(proposal.id, { status: 'duplicate', reason: 'open task with a matching title already exists' });
    return getStores().proposals.getById(proposal.id);
  }

  const task = taskSvc().createTask({ title: proposal.title, type: proposal.type, priority: proposal.priority });
  getDataService(proposalRoot()).updateTask(task.id, { source: 'classification', ...(proposal.workflow ? { workflow: proposal.workflow } : {}) });

  const now = new Date().toISOString();
  getStores().proposals.update(proposal.id, { status: 'applied', appliedTaskId: task.id, appliedAt: now });

  findingsService.linkFindingToTask(proposal.findingId, task.id);
  findingsService.updateStatus(proposal.findingId, 'approved', actorId);

  emitEvent('finding.classified', 'classification', {
    proposalId: proposal.id,
    findingId: proposal.findingId,
    taskId: task.id,
    actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: 'classification.apply',
    targetType: 'proposal',
    targetId: proposal.id,
    details: { findingId: proposal.findingId, taskId: task.id },
    timestamp: now
  });

  return getStores().proposals.getById(proposal.id);
}

export function rejectProposal(proposalIdInput: string, actorId?: string): TaskProposal | undefined {
  const gate = requireEmployeePermission('classification:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  const now = new Date().toISOString();
  getStores().proposals.update(proposal.id, { status: 'rejected', reason: 'rejected by review' });

  emitEvent('task.proposal.rejected', 'classification', {
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

export interface ProposalEditChanges {
  title?: string;
  type?: string;
  priority?: string;
  workflow?: string;
}

function mergeProposalPayload(before: TaskProposalTaskPayload, changes: ProposalEditChanges): TaskProposalTaskPayload {
  let title = before.title;
  if (changes.title !== undefined) {
    title = changes.title.trim();
    if (title.length === 0) {throw new Error('invalid proposal title: must be non-empty');}
  }

  let type: Task['type'] = before.type;
  if (changes.type !== undefined) {
    if (!TASK_TYPES.includes(changes.type as Task['type'])) {throw new Error(`invalid proposal type '${changes.type}'`);}
    type = changes.type as Task['type'];
  }

  let priority: Task['priority'] = before.priority;
  if (changes.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(changes.priority as Task['priority'])) {throw new Error(`invalid proposal priority '${changes.priority}'`);}
    priority = changes.priority as Task['priority'];
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

export function editProposal(proposalIdInput: string, changes: ProposalEditChanges = {}, actorId?: string): TaskProposal | undefined {
  const gate = requireEmployeePermission('classification:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const proposal = getStores().proposals.getById(proposalIdInput);
  if (!proposal) {return undefined;}
  if (proposal.status !== 'pending') {return proposal;}

  const before: TaskProposalTaskPayload = {
    title: proposal.title,
    type: proposal.type,
    priority: proposal.priority,
    ...(proposal.workflow ? { workflow: proposal.workflow } : {})
  };
  const after = mergeProposalPayload(before, changes);

  const now = new Date().toISOString();
  const edit: TaskProposalEdit = { at: now, ...(actorId ? { by: actorId } : {}), before, after };
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

  emitEvent('task.proposal.edited', 'classification', {
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

    if (gateMode('task-proposal') === 'auto') {
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
        type: 'task-proposal',
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