import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { Approval } from '../../data/types';
import { planTitleFor } from '../../services/workforce/plan/planService';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem, formatStamp } from '../section/SectionTreeDataProvider';

/**
 * Approvals are a categorized view over Plans: each approval that carries a
 * plan/run link is grouped under its canonical Plan id. Configuration-change
 * approvals have no plan link and are shown in an "Unlinked" bucket. Resolution
 * still flows through approvals.resolveApproval (the only backend path).
 */
export class ApprovalsTreeDataProvider extends SectionTreeDataProvider {
  private readonly groupPlanId = new WeakMap<vscode.TreeItem, string | undefined>();

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.buildGroups();
    }
    if (element.contextValue === 'approvalGroup') {
      return this.buildApprovals(this.groupPlanId.get(element));
    }
    return [];
  }

  private buildGroups(): vscode.TreeItem[] {
    const approvals = getStores().approvals.loadAll();
    if (approvals.length === 0) {
      return [emptyItem('No approvals')];
    }

    const byPlan = new Map<string | undefined, number>();
    for (const approval of approvals) {
      const key = this.planIdFor(approval);
      byPlan.set(key, (byPlan.get(key) || 0) + 1);
    }

    const groups: vscode.TreeItem[] = [];
    for (const [planId, count] of byPlan) {
      const label = planId ? (planTitleFor(getStores().plans.getById(planId)) || planId) : 'Unlinked';
      const item = new SectionItem(
        `${label} (${count})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'approvalGroup',
        undefined,
        {
          icon: planId ? 'checklist' : 'question',
          description: planId || 'no plan link',
          tooltip: planId ? `Approvals linked to Plan ${planId}` : 'Approvals with no Plan link'
        }
      );
      this.groupPlanId.set(item, planId);
      groups.push(item);
    }

    groups.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return groups;
  }

  private buildApprovals(planId: string | undefined): vscode.TreeItem[] {
    const approvals = getStores().approvals.loadAll().filter(a => this.planIdFor(a) === planId);
    return approvals.map(approval => new SectionItem(
      approval.reason || approval.target,
      vscode.TreeItemCollapsibleState.None,
      approval.status === 'pending' ? 'approvalItemPending' : 'approvalItem',
      { kind: 'approval', approval },
      {
        icon: approval.status === 'pending' ? 'bell' : approval.status === 'approved' ? 'check' : 'close',
        description: `${approval.type} · ${approval.status}`,
        tooltip: this.approvalTooltip(approval),
        command: {
          command: 'sprintdesk.openInControlCenter',
          title: 'Open Approvals',
          arguments: ['approvals']
        }
      }
    ));
  }

  private planIdFor(approval: Approval): string | undefined {
    const pending = approval.pending;
    switch (pending.op) {
      case 'authorize-deploy':
        return pending.planId;
      case 'start-run':
        return getStores().runs.getById(pending.runId)?.planId;
      case 'apply-proposal': {
        const proposal = getStores().proposals.getById(pending.proposalId);
        if (!proposal) {return undefined;}
        if (proposal.runId) {
          const planId = getStores().runs.getById(proposal.runId)?.planId;
          if (planId) {return planId;}
        }
        return getStores().findings.getById(proposal.findingId)?.planId;
      }
      default:
        return undefined;
    }
  }

  private approvalTooltip(approval: Approval): string {
    const lines = [
      approval.reason,
      `id: ${approval.id}`,
      `type: ${approval.type}`,
      `status: ${approval.status}`,
      `target: ${approval.target}`
    ];
    if (approval.requesterId) {lines.push(`requester: ${approval.requesterId}`);}
    if (approval.decisionBy) {lines.push(`decision by: ${approval.decisionBy}`);}
    if (approval.resolvedAt) {lines.push(`resolved: ${formatStamp(approval.resolvedAt)}`);}
    return lines.join('\n');
  }
}

export const approvalsTreeDataProvider = new ApprovalsTreeDataProvider();
