import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem, formatClock } from '../section/SectionTreeDataProvider';

const REQUEST_ICONS: Record<string, string> = {
  new: 'inbox',
  planned: 'check',
  failed: 'error'
};

/**
 * Requests = the Plan-native name for inputs (.SprintDesk/inputs/*.md). This
 * view is a read-only projection of InputStore; it never introduces a second
 * work model and every mutation goes through the Orchestrator.
 */
export class RequestsTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const inputs = getStores().inputs.loadAll()
      .slice()
      .sort((a, b) => (a.ingestedAt < b.ingestedAt ? 1 : -1));

    if (inputs.length === 0) {
      return [emptyItem('No requests — create one from the Control Center')];
    }

    return inputs.map(input => new SectionItem(
      input.file.replace(/^inputs\//, ''),
      vscode.TreeItemCollapsibleState.None,
      'requestInput',
      { kind: 'input', input },
      {
        icon: REQUEST_ICONS[input.status] || 'file',
        description: `${input.status} · ${input.id}${formatClock(input.ingestedAt) ? ' · ' + formatClock(input.ingestedAt) : ''}`,
        tooltip: `${input.id}\nstatus: ${input.status}\nsource: ${input.source.type}${input.source.id ? ' (' + input.source.id + ')' : ''}\nfile: ${input.file}`,
        command: {
          command: 'sprintdesk.openInput',
          title: 'Open Request',
          arguments: [input.id]
        }
      }
    ));
  }
}

export const requestsTreeDataProvider = new RequestsTreeDataProvider();
