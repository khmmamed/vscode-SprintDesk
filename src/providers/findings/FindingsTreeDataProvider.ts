import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { Finding } from '../../data/types';
import { planTitleFor } from '../../services/workforce/plan/planService';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

/**
 * Findings are a categorized view over Plans: every finding that was produced by
 * a run is grouped under its canonical Plan id; findings with no plan link land
 * in a single "Unlinked" bucket. No parallel finding-plan storage is created.
 */
export class FindingsTreeDataProvider extends SectionTreeDataProvider {
  private readonly groupPlanId = new WeakMap<vscode.TreeItem, string | undefined>();

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.buildGroups();
    }
    if (element.contextValue === 'findingGroup') {
      return this.buildFindings(this.groupPlanId.get(element));
    }
    return [];
  }

  private buildGroups(): vscode.TreeItem[] {
    const findings = getStores().findings.loadAll();
    if (findings.length === 0) {
      return [emptyItem('No findings')];
    }

    const byPlan = new Map<string | undefined, number>();
    for (const finding of findings) {
      const key = finding.planId;
      byPlan.set(key, (byPlan.get(key) || 0) + 1);
    }

    const groups: vscode.TreeItem[] = [];
    for (const [planId, count] of byPlan) {
      const label = planId ? (planTitleFor(getStores().plans.getById(planId)) || planId) : 'Unlinked';
      const item = new SectionItem(
        `${label} (${count})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'findingGroup',
        undefined,
        {
          icon: planId ? 'checklist' : 'question',
          description: planId || 'no plan link',
          tooltip: planId ? `Findings linked to Plan ${planId}` : 'Findings with no Plan link'
        }
      );
      this.groupPlanId.set(item, planId);
      groups.push(item);
    }

    groups.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return groups;
  }

  private buildFindings(planId: string | undefined): vscode.TreeItem[] {
    const findings = getStores().findings.loadAll().filter(f => f.planId === planId);
    return findings.map(finding => new SectionItem(
      finding.title,
      vscode.TreeItemCollapsibleState.None,
      'findingItem',
      { kind: 'finding', finding },
      {
        icon: finding.status === 'pending' ? 'search' : finding.status === 'approved' ? 'check' : 'close',
        description: `${finding.status} · ${finding.severity}`,
        tooltip: this.findingTooltip(finding),
        command: {
          command: 'sprintdesk.openInControlCenter',
          title: 'Open Findings',
          arguments: ['findings']
        }
      }
    ));
  }

  private findingTooltip(finding: Finding): string {
    const lines = [
      finding.title,
      `id: ${finding.id}`,
      `status: ${finding.status} · severity: ${finding.severity}`,
      `agent: ${finding.agentName || finding.agent}`,
      `plan: ${finding.planId || 'unlinked'}`
    ];
    if (finding.description) {lines.push(finding.description);}
    return lines.join('\n');
  }
}

export const findingsTreeDataProvider = new FindingsTreeDataProvider();
