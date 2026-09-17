import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { ScheduleRecord } from '../../data/types';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

/**
 * Schedules are a categorized view: ScheduleRecord entries are configuration
 * that materialize Plans through the scheduler. This view never creates Plan
 * copies; it links to canonical Plan ids only through the registry.
 */
export class SchedulesTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const schedules = getStores().schedules.loadAll()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    if (schedules.length === 0) {
      return [emptyItem('No schedules')];
    }

    return schedules.map(schedule => new SectionItem(
      schedule.name,
      vscode.TreeItemCollapsibleState.None,
      'scheduleItem',
      { kind: 'schedule', schedule },
      {
        icon: schedule.enabled ? 'calendar' : 'circle-slash',
        description: `${schedule.enabled ? 'enabled' : 'disabled'} · ${schedule.kind}${this.cadence(schedule)}`,
        tooltip: this.scheduleTooltip(schedule),
        command: {
          command: 'sprintdesk.openInControlCenter',
          title: 'Open Schedules',
          arguments: ['schedules']
        }
      }
    ));
  }

  private cadence(schedule: ScheduleRecord): string {
    if (schedule.kind === 'cron' && schedule.cron) {return ` · ${schedule.cron}`;}
    if (schedule.kind === 'interval' && schedule.intervalMs) {return ` · every ${Math.round(schedule.intervalMs / 1000)}s`;}
    return schedule.action ? ` · ${schedule.action}` : '';
  }

  private scheduleTooltip(schedule: ScheduleRecord): string {
    const lines = [
      schedule.name,
      `id: ${schedule.id}`,
      `kind: ${schedule.kind} · ${schedule.enabled ? 'enabled' : 'disabled'}`,
      `autonomy: L${schedule.autonomyLevel}`,
      `runs: ${schedule.runCount}`
    ];
    if (schedule.action) {lines.push(`action: ${schedule.action}`);}
    if (schedule.planTemplate?.name) {lines.push(`plan template: ${schedule.planTemplate.name}`);}
    if (schedule.lastRunAt) {lines.push(`last run: ${new Date(schedule.lastRunAt).toLocaleString()}`);}
    return lines.join('\n');
  }
}

export const schedulesTreeDataProvider = new SchedulesTreeDataProvider();
