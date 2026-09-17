import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { WorkflowDefinition, WorkflowStep } from '../../data/types';
import { planTitleFor } from '../../services/workforce/plan/planService';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

const STEP_ICONS: Record<WorkflowStep['type'], string> = {
  plan: 'checklist',
  loop: 'sync',
  tool: 'tools',
  condition: 'git-branch'
};

/**
 * Workflows are a categorized view over Plans. The WorkflowDefinition is the
 * configuration; the Plans it materializes are reached indirectly through the
 * event rules that name this workflow and the execution windows that include
 * it. Only canonical Plan ids are resolved here.
 */
export class WorkflowsTreeDataProvider extends SectionTreeDataProvider {
  private readonly groupPlans = new WeakMap<vscode.TreeItem, string[]>();

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.buildWorkflowRows();
    }
    if (element.contextValue === 'workflowItem') {
      return this.buildWorkflowChildren(element);
    }
    if (element.contextValue === 'workflowPlanGroup') {
      return this.buildPlanRows(this.groupPlans.get(element) || []);
    }
    return [];
  }

  private buildWorkflowRows(): vscode.TreeItem[] {
    const workflows = getStores().workflows.loadAll()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    if (workflows.length === 0) {
      return [emptyItem('No workflows')];
    }

    return workflows.map(workflow => new SectionItem(
      workflow.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      'workflowItem',
      { kind: 'workflow', workflow },
      {
        icon: workflow.enabled ? 'project' : 'circle-slash',
        description: `v${workflow.version} · ${workflow.enabled ? 'enabled' : 'disabled'} · ${workflow.steps.length} steps`,
        tooltip: `${workflow.name}\nid: ${workflow.id}\nversion: ${workflow.version}\nenabled: ${workflow.enabled}\nsteps: ${workflow.steps.length}`
      }
    ));
  }

  private buildWorkflowChildren(element: vscode.TreeItem): vscode.TreeItem[] {
    const workflow = (element as SectionItem).payload;
    if (!workflow || workflow.kind !== 'workflow') {return [];}

    const items: vscode.TreeItem[] = workflow.workflow.steps.map(step => this.stepItem(step));

    const planIds = this.materializedPlanIds(workflow.workflow.id);
    const group = new SectionItem(
      `Plans (${planIds.length})`,
      planIds.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'workflowPlanGroup',
      undefined,
      {
        icon: 'checklist',
        description: 'materialized by this workflow',
        tooltip: 'Canonical Plans materialized via event rules or execution windows'
      }
    );
    this.groupPlans.set(group, planIds);
    items.push(group);

    return items;
  }

  private stepItem(step: WorkflowStep): vscode.TreeItem {
    const label = step.name || (step.type === 'plan' ? step.title : step.id);
    const description = step.type === 'loop'
      ? `loop ×${step.maxIterations}`
      : step.type === 'tool'
        ? `${step.serverId}/${step.toolName}`
        : step.type === 'condition'
          ? 'condition'
          : `${step.category} · ${step.priority}`;

    return new SectionItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'workflowStepItem',
      undefined,
      {
        icon: STEP_ICONS[step.type],
        description,
        tooltip: `step ${step.id}\ntype: ${step.type}\n${description}`
      }
    );
  }

  private buildPlanRows(planIds: string[]): vscode.TreeItem[] {
    if (planIds.length === 0) {
      return [emptyItem('No materialized plans')];
    }
    return planIds.map(planId => {
      const plan = getStores().plans.getById(planId);
      const item = new SectionItem(
        plan ? (planTitleFor(plan) || plan.id) : planId,
        vscode.TreeItemCollapsibleState.None,
        plan ? 'planItem' : 'sectionEmpty',
        plan ? { kind: 'plan', plan } : undefined,
        {
          icon: 'checklist',
          description: plan ? `${plan.id} · ${plan.execution?.status || 'unassigned'}` : 'missing plan',
          tooltip: plan ? `Plan ${plan.id}` : `Plan ${planId} is not in the registry`
        }
      );
      if (plan) {
        item.command = {
          command: 'sprintdesk.openPlan',
          title: 'Open Plan',
          arguments: [item]
        };
      }
      return item;
    });
  }

  private materializedPlanIds(workflowId: string): string[] {
    const ids = new Set<string>();
    for (const rule of getStores().eventRules.loadAll()) {
      if (rule.workflowId !== workflowId) {continue;}
      for (const trigger of rule.recentTriggers || []) {
        for (const planId of trigger.createdPlanIds || []) {
          ids.add(planId);
        }
      }
    }
    for (const window of getStores().executionWindows.loadAll()) {
      if (!window.workflowIds?.includes(workflowId)) {continue;}
      for (const planId of window.planIds || []) {
        ids.add(planId);
      }
    }
    return [...ids];
  }
}

export const workflowsTreeDataProvider = new WorkflowsTreeDataProvider();
