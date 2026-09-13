import * as vscode from 'vscode';
import { getWebviewContent } from '../../webview/getWebviewContent';
import * as fileService from '../../services/fileService';
import * as taskService from '../../services/taskService';
import * as queueService from '../../services/workforce/queueService';
import * as worker from '../../services/workforce/worker/worker';
import { getStores } from '../../data/stores';
import { getActivitySummary } from '../../services/workforce/observability';
import * as findingsService from '../../services/workforce/findingsService';
import * as workforceService from '../../services/workforce/workforceService';
import { getDataService } from '../../data/DataService';
import { Employee, EmployeeModelProfile, Finding, FindingStatus, Run, Task, WorkerMode } from '../../data/types';
import { workforceTreeDataProvider } from '../../providers/workforce/WorkforceTreeDataProvider';

export type WorkforceSection =
  | 'employees'
  | 'tasks'
  | 'runs'
  | 'findings'
  | 'approvals'
  | 'schedules'
  | 'workflows'
  | 'activity'
  | 'create-task';

export interface RunDto {
  id: string;
  taskId: string;
  taskTitle: string;
  taskCode: string;
  agentName: string;
  agentId?: string;
  status: Run['status'];
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  result?: string;
  error?: string;
  summary?: { findings: number; errors: number };
}

export interface EmployeeDto {
  id: string;
  name: string;
  role: Employee['role'];
  status?: Employee['status'];
  capabilities: string[];
  modelProfile?: { provider?: string; model?: string; baseUrl?: string };
  agentConfig?: { tool?: string; command?: string; model?: string };
  permissions: string[];
}

export interface TaskDto {
  id: string;
  title: string;
  code: string;
  status: Task['status'];
  workStatus?: string;
  priority?: string;
  agent?: string;
}

export interface FindingDto {
  id: string;
  title: string;
  severity: Finding['severity'];
  confidence?: number;
  status: FindingStatus;
  agentId: string;
  agentName: string;
  timestamp: string;
  runId: string;
  runStatus?: Run['status'];
  taskId?: string;
  taskTitle?: string;
  category?: string;
}

let panel: vscode.WebviewPanel | undefined;
let panelContext: vscode.ExtensionContext | undefined;
let pendingInit: { section?: WorkforceSection; focusAgentId?: string } | undefined;

function dataService() {
  const ws = fileService.getWorkspaceRoot();
  return ws ? getDataService(ws) : undefined;
}

function getRunDto(run: Run): RunDto {
  const ds = dataService();
  const task = ds ? ds.getTask(run.taskId) : undefined;
  const employee = run.agentId ? getStores().employees.getById(run.agentId) : undefined;
  return {
    id: run.id,
    taskId: run.taskId,
    taskTitle: task?.title || run.taskId,
    taskCode: task?.code || '',
    agentName: employee?.name || run.agentId || '',
    agentId: run.agentId,
    status: run.status,
    attempts: run.attempts,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    result: run.result,
    error: run.error,
    summary: run.summary
  };
}

function allRunDtos(): RunDto[] {
  return getStores()
    .runs.loadAll()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(getRunDto);
}

function employeeDtos(): EmployeeDto[] {
  return getStores().employees.loadAll().map(e => ({
    id: e.id,
    name: e.name,
    role: e.role,
    status: e.status,
    capabilities: e.capabilities || [],
    modelProfile: e.modelProfile
      ? { provider: e.modelProfile.provider, model: e.modelProfile.model, baseUrl: e.modelProfile.baseUrl }
      : undefined,
    agentConfig: e.agentConfig
      ? { tool: e.agentConfig.tool, command: e.agentConfig.command, model: e.agentConfig.model }
      : undefined,
    permissions: getStores().policy.getEmployeePermissions(e)
  }));
}

function taskDtos(): TaskDto[] {
  const ds = dataService();
  if (!ds) {return [];}
  return ds.loadTasks().map(t => ({
    id: t.id,
    title: t.title,
    code: t.code,
    status: t.status,
    workStatus: t.workStatus,
    priority: t.priority,
    agent: t.agent
  }));
}

function findingDtos(): FindingDto[] {
  const ds = dataService();
  return findingsService.allFindings(200).map(f => {
    const run = f.source?.runId ? getStores().runs.getById(f.source.runId) : undefined;
    const task = f.taskId && ds ? ds.getTask(f.taskId) : undefined;
    return {
      id: f.id,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      status: f.status,
      agentId: f.agent,
      agentName: f.agentName || f.agent,
      timestamp: f.timestamp,
      runId: f.source?.runId || '',
      runStatus: run?.status,
      taskId: f.taskId,
      taskTitle: task?.title || f.taskId,
      category: f.category
    };
  });
}

function pushRun(panelRef: vscode.WebviewPanel, run: Run): void {
  const message = { command: 'RUN_UPDATED', payload: { run: getRunDto(run) } };
  try {
    panelRef.webview.postMessage(message);
  } catch {
    // panel may be disposed mid-flight
  }
}

function pushSnapshot(panelRef: vscode.WebviewPanel): void {
  const overview = getActivitySummary();
  const counts = {
    pendingApprovals: getStores().approvals.loadAll().filter(a => a.status === 'pending').length,
    pendingFindings: findingsService.pendingFindingCount(),
    schedules: getStores().schedules.loadAll().length,
    workflows: getStores().workflows.loadAll().length
  };
  try {
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_OVERVIEW', payload: { overview } });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_COUNTS', payload: counts });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_EMPLOYEES', payload: employeeDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_TASKS', payload: taskDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_RUNS', payload: allRunDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_FINDINGS', payload: findingDtos() });
  } catch {
    // panel may be disposed mid-flight
  }
}

function postResponse(panelRef: vscode.WebviewPanel, requestId: string, payload: unknown, error?: string): void {
  try {
    panelRef.webview.postMessage({ command: 'WORKFORCE_RESPONSE', requestId, payload, error });
  } catch {
    // ignore
  }
}

async function handleCreateTask(message: any, panelRef: vscode.WebviewPanel): Promise<void> {
  const { requestId, payload } = message;
  const title: string | undefined = payload?.title;
  if (!title || !String(title).trim()) {
    postResponse(panelRef, requestId, undefined, 'Task title is required');
    return;
  }

  const ws = fileService.getWorkspaceRoot();
  if (!ws) {
    postResponse(panelRef, requestId, undefined, 'No workspace is open');
    return;
  }

  const agentId: string | undefined = payload?.agentId;
  const mode: WorkerMode | undefined = payload?.runMode;
  const outcome: any = { ran: false, approvalRequired: false, skipReason: undefined };

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SprintDesk: creating task and queueing run…' },
      async () => {
        const task = await taskService.createTask(ws, {
          title: String(title).trim(),
          type: payload?.type || 'feature',
          status: payload?.status || 'waiting',
          priority: payload?.priority || 'medium',
          backlog: payload?.backlog || undefined,
          epic: payload?.epic || null
        });

        if (agentId) {
          taskService.updateTask(task.id, { agent: agentId });
        }

        const run = queueService.createRun(task.id, agentId);
        outcome.runId = run.id;
        outcome.taskId = task.id;
        pushRun(panelRef, run);
        workforceTreeDataProvider.refresh();

        if (![undefined, 'queue'].includes(mode)) {
          outcome.ran = true;
          const selected: WorkerMode = mode || 'noop';
          const started = queueService.startRun(run.id);
          if (started) {
            pushRun(panelRef, started);
            workforceTreeDataProvider.refresh();
            const result = await worker.executeRun(run.id, selected);
            const finished = getStores().runs.getById(run.id);
            if (finished) {
              pushRun(panelRef, finished);
              workforceTreeDataProvider.refresh();
            }
            outcome.result = result;
          } else {
            const current = getStores().runs.getById(run.id);
            outcome.status = current?.status || 'queued';
            const gates = queueService.getQueueSettings().approvalGates;
            outcome.approvalRequired = current?.status === 'queued' && gates?.runExecution === 'manual';
            workforceTreeDataProvider.refresh();
          }
        }
      }
    );
  } catch (error) {
    postResponse(panelRef, requestId, undefined, error instanceof Error ? error.message : String(error));
    return;
  }

  postResponse(panelRef, requestId, outcome);
}

export function openWorkforceControlCenter(section?: WorkforceSection, focusAgentId?: string): void {
  const context = panelContext;
  if (!context) {return;}

  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    try {
      panel.webview.postMessage({
        command: 'SET_WORKFORCE_INIT',
        payload: { section, focusAgentId }
      });
    } catch {
      // panel may be disposed mid-flight
    }
    pushSnapshot(panel);
    return;
  }

  const newPanel = vscode.window.createWebviewPanel(
    'sprintdesk-workforce',
    'Workforce Control Center',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel = newPanel;
  newPanel.webview.html = getWebviewContent(context, newPanel.webview, 'workforce');

  newPanel.webview.onDidReceiveMessage(
    async (message) => {
      const command: string = message?.command || '';
      if (command === 'WORKFORCE_INIT') {
        if (pendingInit) {
          try {
            newPanel.webview.postMessage({ command: 'SET_WORKFORCE_INIT', payload: pendingInit });
          } catch {
            // panel may be disposed mid-flight
          }
          pendingInit = undefined;
        }
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_REFRESH') {
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_GET_RUNS') {
        try {
          newPanel.webview.postMessage({ command: 'SET_WORKFORCE_RUNS', payload: allRunDtos() });
        } catch {
          // panel may be disposed mid-flight
        }
      } else if (command === 'WORKFORCE_CREATE_TASK') {
        await handleCreateTask(message, newPanel);
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_CANCEL_RUN') {
        const runId: string | undefined = message?.payload?.runId;
        if (runId) {
          try {
            const cancelled = queueService.cancelRun(runId);
            if (cancelled) {pushRun(newPanel, cancelled);}
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_DECIDE_FINDING') {
        const findingId: string | undefined = message?.payload?.findingId;
        const decision: string | undefined = message?.payload?.decision;
        if (findingId && (decision === 'approved' || decision === 'rejected')) {
          try {
            const updated = findingsService.updateStatus(findingId, decision);
            if (updated) {
              newPanel.webview.postMessage({
                command: 'FINDING_UPDATED',
                payload: { finding: findingDtos().find(f => f.id === findingId) }
              });
            }
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        } else if (command === 'WORKFORCE_UPDATE_AGENT') {
        const employeeId: string | undefined = message?.payload?.employeeId;
        const change = message?.payload?.change || {};
        const changes: workforceService.EmployeeConfigChange = {};

        if (change?.modelProfile && typeof change.modelProfile.model === 'string' && change.modelProfile.model.trim()) {
          const mp: EmployeeModelProfile = {
            name: getStores().employees.getById(employeeId || '')?.name || employeeId || '',
            provider: change.modelProfile.provider === 'openai' ? 'openai' : 'ollama',
            model: String(change.modelProfile.model).trim()
          };
          const baseUrl = change.modelProfile.baseUrl ? String(change.modelProfile.baseUrl).trim() : '';
          if (baseUrl) {mp.baseUrl = baseUrl;}
          changes.modelProfile = mp;
        }
        if (change?.agentConfig && typeof change.agentConfig.tool === 'string' && change.agentConfig.tool.trim()) {
          const ac: { tool: 'opencode' | 'ollama' | 'claude-code' | 'custom'; command?: string } = {
            tool: change.agentConfig.tool as 'opencode' | 'ollama' | 'claude-code' | 'custom'
          };
          const command = change.agentConfig.command ? String(change.agentConfig.command).trim() : '';
          if (command) {ac.command = command;}
          changes.agentConfig = ac;
        }
        if (Array.isArray(change?.capabilities)) {
          changes.capabilities = change.capabilities.map((c: string) => String(c).trim()).filter(Boolean);
        }

        if (employeeId && Object.keys(changes).length > 0) {
          try {
            const result = workforceService.applyConfigChange(employeeId, changes);
            newPanel.webview.postMessage({
              command: 'AGENT_CONFIGURED',
              payload: { outcome: result, employee: employeeDtos().find(e => e.id === employeeId) }
            });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
          workforceTreeDataProvider.refresh();
          pushSnapshot(newPanel);
        }
      }
    },
    undefined,
    context.subscriptions
  );

  newPanel.onDidDispose(
    () => {
      if (panel === newPanel) {
        panel = undefined;
        pendingInit = undefined;
      }
    },
    undefined,
    context.subscriptions
  );

  pendingInit = { section, focusAgentId };
  pushSnapshot(newPanel);
}

export function registerWorkforceControlCenter(context: vscode.ExtensionContext): void {
  panelContext = context;
  const disposable = vscode.commands.registerCommand('sprintdesk.openWorkforce', (section?: WorkforceSection) => {
    openWorkforceControlCenter(section);
  });
  context.subscriptions.push(disposable);
}