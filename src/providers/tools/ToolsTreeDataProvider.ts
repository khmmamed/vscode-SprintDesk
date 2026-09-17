import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

/**
 * Tools = the ToolStore catalog (.SprintDesk/database/tools.yml). Agents hold
 * tool references (Employee.tools) resolved against this catalog.
 */
export class ToolsTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const store = getStores().tools;
    store.seedDefaultTools();
    const tools = store.loadAll().slice().sort((a, b) => a.name.localeCompare(b.name));

    if (tools.length === 0) {
      return [emptyItem('No tools in the catalog')];
    }

    return tools.map(tool => new SectionItem(
      tool.name,
      vscode.TreeItemCollapsibleState.None,
      'toolItem',
      { kind: 'tool', tool },
      {
        icon: 'tools',
        description: tool.category,
        tooltip: `${tool.name}${tool.category ? ' (' + tool.category + ')' : ''}\n${tool.description || ''}`
      }
    ));
  }
}

export const toolsTreeDataProvider = new ToolsTreeDataProvider();
