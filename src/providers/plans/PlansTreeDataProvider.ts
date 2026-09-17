import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { Plan } from '../../data/types';
import { planTitleFor } from '../../services/workforce/plan/planService';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

const PLAN_STATUS_ICONS: Record<string, string> = {
  unassigned: 'circle-outline',
  assigned: 'person',
  running: 'sync~spin',
  completed: 'check',
  failed: 'error'
};

/**
 * Plans = the canonical PlanStore. Every other categorized view resolves Plan
 * ids from here; this is the only view that renders the registry itself.
 */
export class PlansTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const plans = getStores().plans.loadAll()
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    if (plans.length === 0) {
      return [emptyItem('No plans — organize a request to materialize one')];
    }

    return plans.map(plan => this.planItem(plan));
  }

  private planItem(plan: Plan): SectionItem {
    const title = planTitleFor(plan) || plan.id;
    const priority = plan.classification?.current?.priority || plan.classification?.original?.priority;
    const status = plan.execution?.status || 'unassigned';
    const parts = [plan.id, plan.scheduling?.status, status];
    if (priority) {parts.push(priority);}
    if (plan.execution?.assignedAgent) {parts.push(plan.execution.assignedAgent);}

    const item = new SectionItem(
      title,
      vscode.TreeItemCollapsibleState.None,
      'planItem',
      { kind: 'plan', plan },
      {
        icon: PLAN_STATUS_ICONS[status] || 'checklist',
        description: parts.filter(Boolean).join(' · '),
        tooltip: this.planTooltip(plan, title)
      }
    );
    item.command = {
      command: 'sprintdesk.openPlan',
      title: 'Open Plan',
      arguments: [item]
    };
    return item;
  }

  private planTooltip(plan: Plan, title: string): string {
    const lines = [
      title,
      `id: ${plan.id}`,
      `source input: ${plan.source?.inputId || 'n/a'}`,
      `schedule: ${plan.scheduling?.status || 'n/a'} (${plan.scheduling?.mode || 'n/a'})`,
      `execution: ${plan.execution?.status || 'unassigned'}`,
      `validation: ${plan.validation?.decision || 'pending'}`
    ];
    if (plan.execution?.assignedAgent) {lines.push(`agent: ${plan.execution.assignedAgent}`);}
    if (plan.validation?.errors?.length) {lines.push(`errors: ${plan.validation.errors.length}`);}
    return lines.join('\n');
  }
}

export const plansTreeDataProvider = new PlansTreeDataProvider();
