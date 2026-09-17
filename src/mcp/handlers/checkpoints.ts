import { getStores } from '../../data/stores';
import { Approval } from '../../data/types';
import * as approvals from '../../services/workforce/approvals';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_checkpointsList(args: any): HandlerResult {
  const stores = getStores();
  const checkpoints = stores.checkpoints.loadAll();
  let filtered = checkpoints;

  if (args.runId) {
    filtered = filtered.filter(cp => cp.runId === args.runId);
  }

  if (args.planId) {
    filtered = filtered.filter(cp => cp.planId === args.planId);
  }

  if (args.status) {
    filtered = filtered.filter(cp => cp.status === args.status);
  }

  return res(JSON.stringify(filtered, null, 2));
}

// v1.0 Slice J — the deploy authorization is keyed by the checkpointId carried on
// the pending op, not by the human-readable `target` string. Matching on target
// never found the real approval, so approve/reject always failed.
function pendingDeployApproval(checkpointId: string): Approval | undefined {
  return getStores().approvals.pending().find(
    p => p.pending?.op === 'authorize-deploy' && p.pending.checkpointId === checkpointId
  );
}

function handle_sprintdesk_checkpointsApproveDeploy(args: any): HandlerResult {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(args.checkpointId);
  if (!checkpoint) return res(`Checkpoint not found: ${args.checkpointId}`, true);

  if (checkpoint.status !== 'deployment-authorizing') {
    return res(`Checkpoint ${args.checkpointId} is not awaiting deploy authorization (current: ${checkpoint.status})`, true);
  }

  const pending = pendingDeployApproval(checkpoint.id);

  if (!pending) {
    return res(`No pending deploy authorization found for checkpoint ${args.checkpointId}`, true);
  }

  const resolved = approvals.approve(pending.id, args.actorId);

  if (!resolved) return res('Failed to approve', true);
  return res(JSON.stringify({ approved: true, approvalId: pending.id, checkpointId: args.checkpointId }, null, 2));
}

function handle_sprintdesk_checkpointsRejectDeploy(args: any): HandlerResult {
  const stores = getStores();
  const checkpoint = stores.checkpoints.getById(args.checkpointId);
  if (!checkpoint) return res(`Checkpoint not found: ${args.checkpointId}`, true);

  if (checkpoint.status !== 'deployment-authorizing') {
    return res(`Checkpoint ${args.checkpointId} is not awaiting deploy authorization (current: ${checkpoint.status})`, true);
  }

  const pending = pendingDeployApproval(checkpoint.id);

  if (!pending) {
    return res(`No pending deploy authorization found for checkpoint ${args.checkpointId}`, true);
  }

  const resolved = approvals.reject(pending.id, args.actorId);

  if (!resolved) return res('Failed to reject', true);
  return res(JSON.stringify({ rejected: true, approvalId: pending.id, checkpointId: args.checkpointId }, null, 2));
}

export const CHECKPOINT_HANDLERS: Record<string, Handler> = {
  sprintdesk_checkpointsList: handle_sprintdesk_checkpointsList,
  sprintdesk_checkpointsApproveDeploy: handle_sprintdesk_checkpointsApproveDeploy,
  sprintdesk_checkpointsRejectDeploy: handle_sprintdesk_checkpointsRejectDeploy,
};
