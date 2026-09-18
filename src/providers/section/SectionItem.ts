import * as vscode from 'vscode';
import {
  Approval,
  Employee,
  EventRecord,
  Finding,
  InputRecord,
  McpServerConfig,
  ModelDefinition,
  Plan,
  Run,
  ScheduleRecord,
  Tool,
  WorkflowDefinition
} from '../../data/types';

/**
 * v1.0 Slice T — the payload carried by a section tree item. Commands narrow on
 * `kind` so a menu action can only ever act on the domain object it expects.
 */
export type SectionPayload =
  | { kind: 'input'; input: InputRecord }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'finding'; finding: Finding }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'schedule'; schedule: ScheduleRecord }
  | { kind: 'workflow'; workflow: WorkflowDefinition }
  | { kind: 'mcpServer'; server: McpServerConfig }
  | { kind: 'mcpTool'; serverId: string; toolName: string }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'model'; model: ModelDefinition }
  | { kind: 'event'; event: EventRecord }
  | { kind: 'run'; run: Run }
  | { kind: 'employee'; employee: Employee };

export type SectionPayloadKind = SectionPayload['kind'];

export interface SectionItemOptions {
  icon?: string;
  description?: string;
  tooltip?: string;
  command?: vscode.Command;
}

export class SectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly payload?: SectionPayload,
    options: SectionItemOptions = {}
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    if (options.icon) {this.iconPath = new vscode.ThemeIcon(options.icon);}
    if (options.description) {this.description = options.description;}
    if (options.tooltip) {this.tooltip = options.tooltip;}
    if (options.command) {this.command = options.command;}
  }
}

/**
 * Narrows a tree item to the payload of an expected kind. Returns undefined for
 * group rows, empty-state rows, and any mismatched item so command handlers can
 * fail closed instead of acting on the wrong object.
 */
export function payloadOf<K extends SectionPayloadKind>(
  item: unknown,
  kind: K
): Extract<SectionPayload, { kind: K }> | undefined {
  const payload = (item as SectionItem | undefined)?.payload;
  if (payload && payload.kind === kind) {
    return payload as Extract<SectionPayload, { kind: K }>;
  }
  return undefined;
}
