import * as approvals from '../../services/workforce/approvals';
import { ApprovalType } from '../../data/types';
import { getStores } from '../../data/stores';
import { gateMode, requestApproval } from '../../services/workforce/gates';
import { performConfigChange } from '../../services/workforce/workforceService';
import { Handler, HandlerResult, res } from './helpers';

function toError(error: unknown): HandlerResult {
  return res(error instanceof Error ? error.message : String(error), true);
}

function handle_sprintdesk_gatesGet(): HandlerResult {
  return res(JSON.stringify(approvals.getGates(), null, 2));
}

function handle_sprintdesk_gatesSet(args: any): HandlerResult {
  try {
    const type: ApprovalType = args.gate;
    const mode = args.mode;
    if (!['task-assignment', 'run-execution', 'config-change'].includes(type)) {
      return res(`Unknown gate: ${type}. Expected one of task-assignment, run-execution, config-change`, true);
    }
    if (!['auto', 'manual'].includes(mode)) {
      return res(`Unknown mode: ${mode}. Expected auto or manual`, true);
    }
    const result = approvals.setGate(type, mode, args.actorId);
    return res(JSON.stringify(result, null, 2));
  } catch (error) {
    return toError(error);
  }
}

function handle_sprintdesk_approvalsList(args: any): HandlerResult {
  const status = args.status || 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res(`Unknown status: ${status}. Expected pending, approved or rejected`, true);
  }
  const limit = typeof args.limit === 'number' ? Math.max(0, args.limit) : undefined;
  const list = approvals.approvalsByStatus(status, limit);
  return res(JSON.stringify({ count: list.length, approvals: list }, null, 2));
}

function handle_sprintdesk_approvalsApprove(args: any): HandlerResult {
  try {
    const approval = approvals.approve(args.approvalId, args.actorId);
    if (!approval) {
      return res(`No pending approval found for ${args.approvalId}`, true);
    }
    return res(JSON.stringify(approval, null, 2));
  } catch (error) {
    return toError(error);
  }
}

function handle_sprintdesk_approvalsReject(args: any): HandlerResult {
  try {
    const approval = approvals.reject(args.approvalId, args.actorId);
    if (!approval) {
      return res(`No pending approval found for ${args.approvalId}`, true);
    }
    return res(JSON.stringify(approval, null, 2));
  } catch (error) {
    return toError(error);
  }
}

function handle_sprintdesk_employeeConfigure(args: any): HandlerResult {
  try {
    const employee = getStores().people
      .loadAll()
      .find(e => e.id === args.employeeId || e.name === args.employeeId);
    if (!employee) return res(`Employee not found: ${args.employeeId}`, true);

    const changes: { modelProfile?: unknown; agentConfig?: unknown; capabilities?: string[] } = {};
    if (args.modelProfile !== undefined) changes.modelProfile = args.modelProfile;
    if (args.agentConfig !== undefined) changes.agentConfig = args.agentConfig;
    if (args.capabilities !== undefined) changes.capabilities = args.capabilities;
    if (Object.keys(changes).length === 0) {
      return res('Provide modelProfile, agentConfig or capabilities to change', true);
    }

    if (gateMode('config-change') === 'manual') {
      const approval = requestApproval({
        type: 'config-change',
        reason: 'Employee config change requires manual approval',
        requesterId: args.actorId,
        target: `${employee.name} (${employee.id})`,
        pending: {
          op: 'apply-config',
          employeeId: employee.id,
          changes: changes as any,
          requesterId: args.actorId
        }
      });
      return res(JSON.stringify({ status: 'pending-approval', approval }, null, 2));
    }

    const updated = performConfigChange(employee.id, changes as any, args.actorId);
    return res(JSON.stringify(updated, null, 2));
  } catch (error) {
    return toError(error);
  }
}

export const APPROVAL_HANDLERS: Record<string, Handler> = {
  sprintdesk_gatesGet: handle_sprintdesk_gatesGet,
  sprintdesk_gatesSet: handle_sprintdesk_gatesSet,
  sprintdesk_approvalsList: handle_sprintdesk_approvalsList,
  sprintdesk_approvalsApprove: handle_sprintdesk_approvalsApprove,
  sprintdesk_approvalsReject: handle_sprintdesk_approvalsReject,
  sprintdesk_employeeConfigure: handle_sprintdesk_employeeConfigure
};