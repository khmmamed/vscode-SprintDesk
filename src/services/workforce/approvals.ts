import { getStores } from '../../data/stores';
import { Approval, ApprovalGateMode, ApprovalGates, ApprovalStatus, ApprovalType } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import { applyProposal } from './classification/classificationService';
import * as queueService from './queueService';
import * as workforceService from './workforceService';
import * as checkpoints from './plan/checkpointService';
import { emitEvent } from './events';
import { getApprovalGates, setApprovalGate } from './gates';

export type ApprovalDecision = 'approved' | 'rejected';

export interface ApproveGateOptions {
  bypassPermission?: boolean;
}

export function pendingApprovals(limit?: number): Approval[] {
  const all = getStores().approvals.pending();
  return limit === undefined ? all : all.slice(0, limit);
}

export function approvalsByStatus(status: ApprovalStatus, limit?: number): Approval[] {
  const all = getStores().approvals.byStatus(status);
  return limit === undefined ? all : all.slice(0, limit);
}

function requireApprovalPermission(permission: 'approval:review' | 'approval:configure', actorId?: string): void {
  const gate = requireEmployeePermission(permission, actorId);
  if (!gate.ok) throw new Error(gate.error);
}

export function resolveApproval(approvalId: string, decision: ApprovalDecision, actorId?: string): Approval | undefined {
  const approval = getStores().approvals.getById(approvalId);
  if (!approval || approval.status !== 'pending') return undefined;

  requireApprovalPermission('approval:review', actorId);

  const pending = approval.pending;

  if (decision === 'approved') {
    switch (pending.op) {
      case 'assign-task':
        workforceService.performTaskAssignment(pending.taskId, pending.employeeId, pending.requesterId || actorId);
        break;
      case 'start-run':
        queueService.startRun(pending.runId, { bypassGate: true });
        break;
      case 'apply-config':
        workforceService.performConfigChange(pending.employeeId, pending.changes, pending.requesterId || actorId);
        break;
      case 'apply-proposal':
        applyProposal(pending.proposalId, pending.requesterId || actorId);
        break;
      case 'authorize-deploy':
        // The resolving (approving) human is the authorizing actor; the approval
        // requester may be a validator agent, which must not self-authorize.
        checkpoints.authorizeDeploy(pending.checkpointId, actorId);
        break;
    }
  }

  const now = new Date().toISOString();
  getStores().approvals.update(approvalId, { status: decision, resolvedAt: now, decisionBy: actorId });

  if (decision === 'rejected' && pending.op === 'authorize-deploy') {
    checkpoints.onDeployRejected(pending.checkpointId, actorId ? { by: actorId } : {});
  }

  emitEvent('approval.resolved', 'workforce', {
    approvalId,
    type: approval.type,
    decision,
    target: approval.target,
    ...(actorId ? { decisionBy: actorId } : {})
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: `approval.${decision}`,
    targetType: 'approval',
    targetId: approvalId,
    details: { type: approval.type, target: approval.target },
    timestamp: now
  });

  return getStores().approvals.getById(approvalId);
}

export function approve(approvalId: string, actorId?: string): Approval | undefined {
  return resolveApproval(approvalId, 'approved', actorId);
}

export function reject(approvalId: string, actorId?: string): Approval | undefined {
  return resolveApproval(approvalId, 'rejected', actorId);
}

export function getGates(): { auto: number; manual: number; gates: ApprovalGates } {
  const gates = getApprovalGates();
  return {
    auto: Object.values(gates).filter(m => m === 'auto').length,
    manual: Object.values(gates).filter(m => m === 'manual').length,
    gates
  };
}

export function setGate(type: ApprovalType, mode: ApprovalGateMode, actorId?: string): { gates: ApprovalGates } {
  requireApprovalPermission('approval:configure', actorId);
  const gates = setApprovalGate(type, mode);
  return { gates };
}