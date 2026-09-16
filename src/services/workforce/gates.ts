import { getStores } from '../../data/stores';
import {
  Approval,
  ApprovalGateMode,
  ApprovalGates,
  ApprovalPending,
  ApprovalType,
  DEFAULT_APPROVAL_GATES
} from '../../data/types';
import { emitEvent } from './events';

export function gateMode(type: ApprovalType): ApprovalGateMode {
  const gates = getStores().queue.getSettings().approvalGates || DEFAULT_APPROVAL_GATES;
  switch (type) {
    case 'task-assignment': return gates.taskAssignment || 'auto';
    case 'run-execution': return gates.runExecution || 'auto';
    case 'config-change': return gates.configChange || 'auto';
    case 'task-proposal': return gates.taskProposal || 'auto';
    case 'deploy-authorization': return gates.deploy || 'manual';
  }
}

export function getApprovalGates(): ApprovalGates {
  return { ...DEFAULT_APPROVAL_GATES, ...(getStores().queue.getSettings().approvalGates || {}) };
}

export function setApprovalGate(type: ApprovalType, mode: ApprovalGateMode): ApprovalGates {
  const store = getStores().queue;
  const current = store.getSettings();
  const gates = { ...DEFAULT_APPROVAL_GATES, ...(current.approvalGates || {}) };
  const key = type === 'task-assignment' ? 'taskAssignment' : type === 'run-execution' ? 'runExecution' : type === 'config-change' ? 'configChange' : type === 'task-proposal' ? 'taskProposal' : 'deploy';
  const next: ApprovalGates = { ...gates, [key]: mode };
  store.saveSettings({ approvalGates: next });
  return next;
}

export function recordApprovalAudit(entry: { actor: string; action: string; targetType: string; targetId?: string; details?: Record<string, unknown> }): void {
  getStores().audit.add({
    ...entry,
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString()
  } as any);
}

export function requestApproval(input: {
  type: ApprovalType;
  reason: string;
  target: string;
  pending: ApprovalPending;
  requesterId?: string;
}): Approval {
  const now = new Date().toISOString();
  const approval: Approval = {
    id: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    status: 'pending',
    reason: input.reason,
    target: input.target,
    requesterId: input.requesterId,
    pending: input.pending,
    createdAt: now
  };
  getStores().approvals.add(approval);
  emitEvent('approval.requested', 'workforce', {
    approvalId: approval.id,
    type: approval.type,
    target: approval.target,
    reason: approval.reason
  });
  recordApprovalAudit({
    actor: input.requesterId || 'system',
    action: 'approval.request',
    targetType: 'approval',
    targetId: approval.id,
    details: { type: approval.type, target: approval.target }
  });
  return approval;
}
