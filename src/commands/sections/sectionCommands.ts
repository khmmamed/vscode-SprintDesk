import * as vscode from 'vscode';
import * as path from 'path';
import { getStores } from '../../data/stores';
import * as workforceService from '../../services/workforce/workforceService';
import * as approvals from '../../services/workforce/approvals';
import { enqueuePlan, requestPlanCancellation, requestPlanReassignment, requestPlanRequeue } from '../../services/workforce/plan/dispatcher';
import { triggerOrganizer } from '../../services/workforce/plan/organizer';
import { resolvePlanFile } from '../../services/workforce/plan/planService';
import { inputArtifactPath } from '../../services/workforce/orchestrator';
import * as mcpRegistry from '../../services/workforce/mcp/registry';
import { inspectServer } from '../../services/workforce/mcp/client';
import { openWorkforceControlCenter, WorkforceSection } from '../workforce/openWorkforceControlCenter';
import { payloadOf, SectionItem } from '../../providers/section/SectionItem';
import { Employee, EmployeeModelProfile, LLMProviderKind, ModelDefinition } from '../../data/types';
import { DEFAULT_OLLAMA_BASEURL } from '../../services/workforce/llm/ollamaProvider';
import { DEFAULT_OPENAI_BASEURL } from '../../services/workforce/llm/openaiProvider';

export interface SectionRefreshTarget {
  refresh(): void;
}

const ITEM_TO_SECTION: Record<string, WorkforceSection> = {
  requestInput: 'inputs',
  planItem: 'plans',
  findingItem: 'findings',
  approvalItem: 'approvals',
  approvalItemPending: 'approvals',
  scheduleItem: 'schedules',
  workflowItem: 'workflows',
  workflowStepItem: 'workflows',
  workflowPlanGroup: 'workflows',
  activityItem: 'activity'
};

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function openArtifact(absPath: string | undefined): Promise<void> {
  if (!absPath) {
    vscode.window.showWarningMessage('SprintDesk: artifact path could not be resolved');
    return;
  }
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`SprintDesk: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function employeeFrom(item: unknown): Employee | undefined {
  const payload = payloadOf(item, 'employee')?.employee;
  if (payload) {return payload;}
  return (item as { employee?: Employee } | undefined)?.employee;
}

async function pickActor(placeHolder: string): Promise<string | undefined> {
  const agents = workforceService.getWorkforce().employees.filter(e => e.role === 'agent');
  const humans = workforceService.getWorkforce().employees.filter(e => e.role === 'human');
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'System (no actor)', value: undefined as string | undefined },
      ...humans.map(h => ({ label: h.name, description: 'human', value: h.id })),
      ...agents.map(a => ({ label: a.name, description: 'agent', value: a.id }))
    ],
    { placeHolder }
  );
  return picked?.value;
}

function modelSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

async function promptModel(existing?: ModelDefinition): Promise<ModelDefinition | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Model name (shown in the Models tree)',
    value: existing?.name ?? ''
  });
  if (name === undefined) {return undefined;}
  if (!name.trim()) {
    vscode.window.showWarningMessage('SprintDesk: a model name is required');
    return undefined;
  }

  const providerPick = await vscode.window.showQuickPick(
    [{ label: 'Ollama', value: 'ollama' as LLMProviderKind }, { label: 'OpenAI', value: 'openai' as LLMProviderKind }],
    { placeHolder: 'Provider' }
  );
  if (!providerPick) {return undefined;}
  const provider = providerPick.value;

  const model = await vscode.window.showInputBox({
    prompt: 'Model id (e.g. gemma2:9b or gpt-4o-mini)',
    value: existing?.model ?? ''
  });
  if (model === undefined) {return undefined;}
  if (!model.trim()) {
    vscode.window.showWarningMessage('SprintDesk: a model id is required');
    return undefined;
  }

  const defaultBaseUrl = provider === 'ollama' ? DEFAULT_OLLAMA_BASEURL : DEFAULT_OPENAI_BASEURL;
  const baseUrl = await vscode.window.showInputBox({
    prompt: 'Base URL (optional)',
    value: existing?.baseUrl ?? defaultBaseUrl
  });
  if (baseUrl === undefined) {return undefined;}

  const apiKeyRef = await vscode.window.showInputBox({
    prompt: 'API key secret reference (optional)',
    value: existing?.apiKeyRef ?? ''
  });
  if (apiKeyRef === undefined) {return undefined;}

  const temperatureInput = await vscode.window.showInputBox({
    prompt: 'Temperature (optional, 0-2)',
    value: existing?.options?.temperature !== undefined ? String(existing.options.temperature) : ''
  });
  if (temperatureInput === undefined) {return undefined;}

  const maxTokensInput = await vscode.window.showInputBox({
    prompt: 'Max tokens (optional)',
    value: existing?.options?.maxTokens !== undefined ? String(existing.options.maxTokens) : ''
  });
  if (maxTokensInput === undefined) {return undefined;}

  const options: NonNullable<ModelDefinition['options']> = {};
  const temperature = temperatureInput.trim() ? Number(temperatureInput.trim()) : undefined;
  if (temperature !== undefined && Number.isFinite(temperature)) {options.temperature = temperature;}
  const maxTokens = maxTokensInput.trim() ? Number(maxTokensInput.trim()) : undefined;
  if (maxTokens !== undefined && Number.isFinite(maxTokens)) {options.maxTokens = maxTokens;}

  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `model_${modelSlug(name)}`,
    name: name.trim(),
    provider,
    model: model.trim(),
    baseUrl: baseUrl.trim() || undefined,
    apiKeyRef: apiKeyRef.trim() || undefined,
    options: Object.keys(options).length ? options : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function modelProfileSnapshot(model: ModelDefinition, employee: Employee): EmployeeModelProfile {
  return {
    name: employee.name,
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    apiKeyRef: model.apiKeyRef,
    options: model.options
  };
}

function assignModelToEmployee(employee: Employee, model: ModelDefinition): { applied: boolean; approvalRequired: boolean } {
  const result = workforceService.applyConfigChange(employee.id, {
    modelProfile: modelProfileSnapshot(model, employee),
    modelId: model.id
  });
  return { applied: result.applied, approvalRequired: Boolean(result.approvalRequired) };
}

export function registerSectionCommands(context: vscode.ExtensionContext, refreshTarget: SectionRefreshTarget): void {
  const refresh = () => refreshTarget.refresh();

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.openInControlCenter', (arg?: unknown) => {
      if (typeof arg === 'string') {
        openWorkforceControlCenter(arg as WorkforceSection);
        return;
      }
      const item = arg as SectionItem | undefined;
      const section = item?.contextValue ? ITEM_TO_SECTION[item.contextValue] : undefined;
      openWorkforceControlCenter(section || 'plans');
    }),

    vscode.commands.registerCommand('sprintdesk.openInput', async (arg?: unknown) => {
      const id = typeof arg === 'string'
        ? arg
        : payloadOf(arg, 'input')?.input.id;
      if (!id) {return;}
      await openArtifact(inputArtifactPath(id));
    }),

    vscode.commands.registerCommand('sprintdesk.openPlan', async (arg?: unknown) => {
      const plan = payloadOf(arg, 'plan')?.plan;
      if (!plan) {return;}
      const root = workspaceRoot();
      await openArtifact(root ? path.join(root, '.SprintDesk', resolvePlanFile(plan)) : undefined);
    }),

    vscode.commands.registerCommand('sprintdesk.createRequest', () => {
      openWorkforceControlCenter('create-input');
    }),

    vscode.commands.registerCommand('sprintdesk.runOrganizer', () => {
      const result = triggerOrganizer();
      refresh();
      vscode.window.showInformationMessage(
        `Organizer pass: ${result.changed} plan(s) updated (${result.examined} examined)`
      );
    }),

    vscode.commands.registerCommand('sprintdesk.enqueuePlan', (arg?: unknown) => {
      const plan = payloadOf(arg, 'plan')?.plan;
      if (!plan) {return;}
      const outcome = enqueuePlan(plan.id);
      refresh();
      vscode.window.showInformationMessage(`Plan ${plan.id}: ${outcome.action}`);
    }),

    vscode.commands.registerCommand('sprintdesk.cancelPlan', async (arg?: unknown) => {
      const plan = payloadOf(arg, 'plan')?.plan;
      if (!plan) {return;}
      const confirm = await vscode.window.showWarningMessage(`Cancel plan "${plan.id}"?`, { modal: true }, 'Cancel Plan');
      if (confirm !== 'Cancel Plan') {return;}
      requestPlanCancellation(plan.id);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.requeuePlan', (arg?: unknown) => {
      const plan = payloadOf(arg, 'plan')?.plan;
      if (!plan) {return;}
      requestPlanRequeue(plan.id);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.reassignPlan', async (arg?: unknown) => {
      const plan = payloadOf(arg, 'plan')?.plan;
      if (!plan) {return;}
      const agents = workforceService.getWorkforce().employees.filter(e => e.role === 'agent');
      const picked = await vscode.window.showQuickPick(
        agents.map(a => ({ label: a.name, description: a.status || 'idle', value: a.id })),
        { placeHolder: `Reassign ${plan.id} to agent` }
      );
      if (!picked) {return;}
      requestPlanReassignment(plan.id, picked.value);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.approveApproval', async (arg?: unknown) => {
      const approval = payloadOf(arg, 'approval')?.approval;
      if (!approval || approval.status !== 'pending') {return;}
      const actorId = await pickActor(`Approve: ${approval.reason}`);
      approvals.approve(approval.id, actorId);
      refresh();
      vscode.window.showInformationMessage(`Approval ${approval.id} approved`);
    }),

    vscode.commands.registerCommand('sprintdesk.rejectApproval', async (arg?: unknown) => {
      const approval = payloadOf(arg, 'approval')?.approval;
      if (!approval || approval.status !== 'pending') {return;}
      const actorId = await pickActor(`Reject: ${approval.reason}`);
      approvals.reject(approval.id, actorId);
      refresh();
      vscode.window.showInformationMessage(`Approval ${approval.id} rejected`);
    }),

    vscode.commands.registerCommand('sprintdesk.toggleSchedule', (arg?: unknown) => {
      const schedule = payloadOf(arg, 'schedule')?.schedule;
      if (!schedule) {return;}
      getStores().schedules.update(schedule.id, { enabled: !schedule.enabled, updatedAt: new Date().toISOString() });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.toggleWorkflow', (arg?: unknown) => {
      const workflow = payloadOf(arg, 'workflow')?.workflow;
      if (!workflow) {return;}
      getStores().workflows.update(workflow.id, { enabled: !workflow.enabled, updatedAt: new Date().toISOString() });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.toggleMcpServer', (arg?: unknown) => {
      const server = payloadOf(arg, 'mcpServer')?.server;
      if (!server) {return;}
      mcpRegistry.upsertMcpServer({ ...server, enabled: !server.enabled });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.removeMcpServer', async (arg?: unknown) => {
      const server = payloadOf(arg, 'mcpServer')?.server;
      if (!server) {return;}
      const confirm = await vscode.window.showWarningMessage(`Remove MCP server "${server.name || server.id}"?`, { modal: true }, 'Remove');
      if (confirm !== 'Remove') {return;}
      mcpRegistry.removeMcpServer(server.id);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.inspectMcpServer', async (arg?: unknown) => {
      const server = payloadOf(arg, 'mcpServer')?.server;
      if (!server) {return;}
      try {
        const info = await inspectServer(server.id);
        vscode.window.showInformationMessage(
          `${server.id}: registered=${info.registered} · enabled=${info.enabled}${info.hasHeaderSecret ? ' · header secret set' : ''}`
        );
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`SprintDesk: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand('sprintdesk.addMcpServer', async () => {
      const id = await vscode.window.showInputBox({ prompt: 'MCP server id' });
      if (!id) {return;}
      const kindPick = await vscode.window.showQuickPick(
        [{ label: 'HTTP', value: 'http' as const }, { label: 'stdio', value: 'stdio' as const }],
        { placeHolder: 'Transport' }
      );
      if (!kindPick) {return;}
      if (kindPick.value === 'http') {
        const url = await vscode.window.showInputBox({ prompt: 'HTTP endpoint URL' });
        if (!url) {return;}
        mcpRegistry.upsertMcpServer({ id, kind: 'http', url, enabled: true });
      } else {
        const command = await vscode.window.showInputBox({ prompt: 'Command to launch the server' });
        if (!command) {return;}
        mcpRegistry.upsertMcpServer({ id, kind: 'stdio', command, enabled: true });
      }
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.addTool', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Tool name (e.g. git, docker)' });
      if (!name) {return;}
      const category = await vscode.window.showInputBox({ prompt: 'Category (optional)' });
      const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
      getStores().tools.upsert({
        id: `tool_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        category: category || undefined,
        description: description || undefined
      });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.removeTool', async (arg?: unknown) => {
      const tool = payloadOf(arg, 'tool')?.tool;
      if (!tool) {return;}
      getStores().tools.delete(tool.id);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.selectAgentMcpServers', async (arg?: unknown) => {
      const employee = employeeFrom(arg);
      if (!employee) {return;}
      const servers = mcpRegistry.listMcpServers();
      const picked = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name || s.id, description: s.id, picked: (employee.mcps || []).includes(s.id) })),
        { canPickMany: true, placeHolder: `MCP servers for ${employee.name}` }
      );
      if (!picked) {return;}
      getStores().people.update(employee.id, { mcps: picked.map(p => p.description as string) });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.selectAgentTools', async (arg?: unknown) => {
      const employee = employeeFrom(arg);
      if (!employee) {return;}
      const store = getStores().tools;
      store.seedDefaultTools();
      const tools = store.loadAll();
      const picked = await vscode.window.showQuickPick(
        tools.map(t => ({ label: t.name, description: t.category, picked: (employee.tools || []).includes(t.name) })),
        { canPickMany: true, placeHolder: `Tools for ${employee.name}` }
      );
      if (!picked) {return;}
      getStores().people.update(employee.id, { tools: picked.map(p => p.label) });
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.addModel', async () => {
      const model = await promptModel();
      if (!model) {return;}
      getStores().models.upsert(model);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.editModel', async (arg?: unknown) => {
      const existing = payloadOf(arg, 'model')?.model;
      if (!existing) {return;}
      const model = await promptModel(existing);
      if (!model) {return;}
      getStores().models.upsert(model);
      refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.removeModel', async (arg?: unknown) => {
      const model = payloadOf(arg, 'model')?.model;
      if (!model) {return;}
      const confirm = await vscode.window.showWarningMessage(
        `Remove model "${model.name}"? Agents keep their assigned profile.`,
        { modal: true },
        'Remove'
      );
      if (confirm !== 'Remove') {return;}
      getStores().models.delete(model.id);
      refresh();
    }),

    // Model-first assignment: pick agents to assign this catalog model to.
    vscode.commands.registerCommand('sprintdesk.assignModelToAgent', async (arg?: unknown) => {
      const model = payloadOf(arg, 'model')?.model;
      if (!model) {return;}
      const agents = getStores().people.loadAll().filter(e => e.role === 'agent');
      if (agents.length === 0) {
        vscode.window.showInformationMessage('SprintDesk: no agents to assign this model to');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        agents
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(a => ({ label: a.name, description: a.modelProfile?.model ? `current: ${a.modelProfile.model}` : 'no model', picked: a.modelId === model.id, employee: a })),
        { canPickMany: true, placeHolder: `Assign ${model.name} to agents` }
      );
      if (!picked) {return;}
      let applied = 0;
      let pending = 0;
      for (const item of picked) {
        const outcome = assignModelToEmployee(item.employee, model);
        if (outcome.applied) {applied++;} else if (outcome.approvalRequired) {pending++;}
      }
      refresh();
      if (pending > 0) {
        vscode.window.showInformationMessage(`SprintDesk: ${applied} assigned, ${pending} awaiting approval`);
      } else {
        vscode.window.showInformationMessage(`SprintDesk: ${model.name} assigned to ${applied} agent(s)`);
      }
    }),

    // Agent-first assignment: pick one catalog model for this agent (or unassign).
    vscode.commands.registerCommand('sprintdesk.selectAgentModel', async (arg?: unknown) => {
      const employee = employeeFrom(arg);
      if (!employee) {return;}
      const store = getStores().models;
      const models = store.loadAll().slice().sort((a, b) => a.name.localeCompare(b.name));
      if (models.length === 0) {
        const add = await vscode.window.showInformationMessage('SprintDesk: no models registered yet', 'Add Model');
        if (add === 'Add Model') {await vscode.commands.executeCommand('sprintdesk.addModel');}
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          { label: '$(close) Unassigned', description: 'clear the assigned model', modelId: '' },
          ...models.map(m => ({
            label: m.name,
            description: `${m.provider} · ${m.model}`,
            modelId: m.id
          }))
        ],
        { placeHolder: `Model for ${employee.name}` }
      );
      if (!picked) {return;}

      if (!picked.modelId) {
        const result = workforceService.applyConfigChange(employee.id, { clearModel: true });
        refresh();
        vscode.window.showInformationMessage(
          result.applied
            ? `SprintDesk: cleared the model for ${employee.name}`
            : `SprintDesk: clearing the model for ${employee.name} awaits approval`
        );
        return;
      }

      const model = store.getById(picked.modelId);
      if (!model) {return;}
      const outcome = assignModelToEmployee(employee, model);
      refresh();
      vscode.window.showInformationMessage(
        outcome.applied
          ? `SprintDesk: assigned ${model.name} to ${employee.name}`
          : `SprintDesk: assigning ${model.name} to ${employee.name} awaits approval`
      );
    })
  );
}
