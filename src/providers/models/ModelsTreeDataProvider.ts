import * as vscode from 'vscode';
import { getStores } from '../../data/stores';
import { Employee, ModelDefinition } from '../../data/types';
import { SectionItem } from '../section/SectionItem';
import { SectionTreeDataProvider, emptyItem } from '../section/SectionTreeDataProvider';

/**
 * v1.0 Slice V — Models = the ModelStore catalog (.SprintDesk/database/models.yml).
 * Expanding a model lists the agents currently assigned to it (via the
 * provenance link `Employee.modelId`, falling back to a provider+model match so
 * agents configured before the catalog existed still show up).
 */
export class ModelsTreeDataProvider extends SectionTreeDataProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.buildModelRows();
    }
    if (element.contextValue === 'modelItem') {
      return this.buildAssignedRows(element);
    }
    return [];
  }

  private buildModelRows(): vscode.TreeItem[] {
    const models = getStores()
      .models.loadAll()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    if (models.length === 0) {
      return [emptyItem('No models registered')];
    }

    return models.map(model => new SectionItem(
      model.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      'modelItem',
      { kind: 'model', model },
      {
        icon: 'vm',
        description: `${model.provider} · ${model.model}`,
        tooltip: this.modelTooltip(model)
      }
    ));
  }

  private buildAssignedRows(element: vscode.TreeItem): vscode.TreeItem[] {
    const payload = (element as SectionItem).payload;
    if (!payload || payload.kind !== 'model') {
      return [];
    }
    const model = payload.model;

    const assigned = getStores()
      .people.loadAll()
      .filter(employee => employee.role === 'agent' && this.isAssigned(employee, model))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (assigned.length === 0) {
      return [emptyItem('Not assigned to any agent')];
    }

    return assigned.map(employee => new SectionItem(
      employee.name,
      vscode.TreeItemCollapsibleState.None,
      'employeeAgent',
      { kind: 'employee', employee },
      {
        icon: 'account',
        description: 'assigned',
        tooltip: `${employee.name} — assigned ${model.name}`
      }
    ));
  }

  private isAssigned(employee: Employee, model: ModelDefinition): boolean {
    if (employee.modelId) {
      return employee.modelId === model.id;
    }
    return employee.modelProfile?.provider === model.provider && employee.modelProfile?.model === model.model;
  }

  private modelTooltip(model: ModelDefinition): string {
    const lines = [`name: ${model.name}`, `provider: ${model.provider}`, `model: ${model.model}`];
    if (model.baseUrl) {lines.push(`baseUrl: ${model.baseUrl}`);}
    if (model.apiKeyRef) {lines.push(`apiKeyRef: ${model.apiKeyRef}`);}
    if (model.options?.temperature !== undefined) {lines.push(`temperature: ${model.options.temperature}`);}
    if (model.options?.maxTokens !== undefined) {lines.push(`maxTokens: ${model.options.maxTokens}`);}
    return lines.join('\n');
  }
}

export const modelsTreeDataProvider = new ModelsTreeDataProvider();
