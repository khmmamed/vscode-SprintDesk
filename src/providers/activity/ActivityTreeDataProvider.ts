import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem, formatClock } from '../section/SectionTreeDataProvider';

const ACTIVITY_LIMIT = 50;

/**
 * Activity is the live EventStore feed (the emitEvent stream). History remains
 * the git + audit view; Activity is deliberately separate.
 */
export class ActivityTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const events = getStores().events.latest(ACTIVITY_LIMIT);
    if (events.length === 0) {
      return [emptyItem('No activity yet')];
    }

    return events.map(event => new SectionItem(
      event.type,
      vscode.TreeItemCollapsibleState.None,
      'activityItem',
      { kind: 'event', event },
      {
        icon: 'history',
        description: `${event.source}${formatClock(event.timestamp) ? ' · ' + formatClock(event.timestamp) : ''}`,
        tooltip: this.eventTooltip(event.type, event.source, event.timestamp, event.payload),
        command: {
          command: 'sprintdesk.openInControlCenter',
          title: 'Open Activity',
          arguments: ['activity']
        }
      }
    ));
  }

  private eventTooltip(type: string, source: string, timestamp: string, payload: Record<string, unknown>): string {
    const lines = [type, `source: ${source}`, `at: ${new Date(timestamp).toLocaleString()}`];
    try {
      const json = JSON.stringify(payload);
      if (json && json !== '{}') {
        lines.push(json.length > 500 ? `${json.slice(0, 500)}…` : json);
      }
    } catch {
      // Ignore payloads that cannot be serialized.
    }
    return lines.join('\n');
  }
}

export const activityTreeDataProvider = new ActivityTreeDataProvider();
