import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';
import { getWebviewContent } from '../../webview/getWebviewContent';
import * as fileService from '../../services/fileService';
import * as approvals from '../../services/workforce/approvals';
import * as queueService from '../../services/workforce/queueService';
import * as classificationService from '../../services/workforce/classification/classificationService';
import { getStores } from '../../data/stores';
import { getActivitySummary, runDetail, getQueueSnapshot, getExecutionWindowReport } from '../../services/workforce/observability';
import { planTitleFor } from '../../services/workforce/plan/planService';
import * as orchestrator from '../../services/workforce/orchestrator';
import * as organizer from '../../services/workforce/plan/organizer';
import * as findingsService from '../../services/workforce/findingsService';
import * as workforceService from '../../services/workforce/workforceService';
import * as eventRulesService from '../../services/workforce/eventRulesService';
import * as executionWindowService from '../../services/workforce/executionWindowService';
import { subscribeEvents } from '../../services/workforce/events';
import { Approval, Checkpoint, Cycle, Employee, EmployeeModelProfile, EventRecord, ExecutionWindow, Finding, FindingStatus, InputRecord, Plan, Run, ScheduleRecord, Proposal, WorkerMode } from '../../data/types';
import { workforceTreeDataProvider } from '../../providers/workforce/WorkforceTreeDataProvider';

export type WorkforceSection =
  | 'employees'
  | 'plans'
  | 'inputs'
  | 'checkpoints'
  | 'cycles'
  | 'runs'
  | 'findings'
  | 'proposals'
  | 'approvals'
  | 'schedules'
  | 'workflows'
  | 'event-rules'
  | 'windows'
  | 'activity'
  | 'create-input';

export interface RunDto {
  id: string;
  // v1.0 Slice D — runs execute Plans (planId/planTitle/planCode).
  planId: string;
  planTitle: string;
  planCode: string;
  planSource?: string;
  trigger?: { ruleId: string; ruleName: string; eventType: string };
  agentName: string;
  agentId?: string;
  status: Run['status'];
  attempts: number;
  availableAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  durationMs?: number;
  result?: string;
  error?: string;
  summary?: { findings: number; errors: number };
  mode?: WorkerMode;
  model?: string;
  windowId?: string;
  windowName?: string;
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
  planId?: string;
  planTitle?: string;
  category?: string;
  agentValidationState?: 'requested' | 'validated';
  agentReview?: {
    validatorId: string;
    validatorName?: string;
    recommendation: 'recommend-approve' | 'recommend-reject' | 'request-revision';
    confidence?: number;
    reason?: string;
    validatedAt: string;
  };
}

export interface PlanDto {
  id: string;
  title: string;
  status: Plan['scheduling']['status'];
  category: string;
  priority: string;
  assignedAgent?: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InputDto {
  id: string;
  file: string;
  title: string;
  status: InputRecord['status'];
  // Human-readable label (never the raw InputSource object — the webview renders this directly).
  source: string;
  sourceType: InputRecord['source']['type'];
  receivedAt: string;
}

export interface CheckpointDto {
  id: string;
  planId: string;
  planTitle?: string;
  status: Checkpoint['status'];
  artifacts: string[];
  gitRef?: string;
  gitCommit?: string;
  deploymentDecision?: Checkpoint['deploymentDecision'];
}

export interface CycleDto {
  id: string;
  planIds: string[];
  inputIds: string[];
  outcome: Cycle['outcome'];
  startedAt: string;
  closedAt?: string;
  organizationPasses: number;
}

export interface EventRuleDto {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  matcher: { eventType?: string; source?: string; payloadKey?: string; payloadValue?: string };
  workflowId: string;
  workflowName?: string;
  runCount: number;
  lastTriggeredAt?: string;
  recentTriggers: Array<{
    eventId: string;
    eventType: string;
    status: 'completed' | 'failed';
    createdAt: string;
    createdPlanIds?: string[];
    error?: string;
  }>;
}

export interface WorkflowDto {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  updatedAt: string;
}

export interface ExecutionWindowDto {
  id: string;
  name: string;
  goal?: string;
  status: ExecutionWindow['status'];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  workflowIds: string[];
  workflowNames: string[];
  agentIds: string[];
  agentNames: string[];
  workerMode?: WorkerMode;
  maxConcurrentRuns?: number;
  runCount: number;
  runs: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  planCount: number;
  findings: { total: number; pendingAgentReview: number; pendingHumanReview: number; approved: number; rejected: number };
  completionSummary?: ExecutionWindow['completionSummary'];
}

export interface ActivityEventDto {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  label: string;
  links: {
    runId?: string;
    planId?: string;
    workflowId?: string;
    ruleId?: string;
    findingId?: string;
    windowId?: string;
    scheduleId?: string;
    employeeId?: string;
  };
}

export interface ApprovalDto {
  id: string;
  type: string;
  status: Approval['status'];
  reason: string;
  target: string;
  requesterId?: string;
  createdAt: string;
  resolvedAt?: string;
  decisionBy?: string;
}

export interface ProposalDto {
  id: string;
  findingId: string;
  title: string;
  type: string;
  priority: string;
  workflow?: string;
  confidence?: number;
  status: string;
  createdAt: string;
  appliedPlanId?: string;
  reason?: string;
  editedAt?: string;
  editCount?: number;
  requeuedAt?: string;
}

export interface ScheduleDto {
  id: string;
  name: string;
  enabled: boolean;
  kind: string;
  autonomyLevel: number;
  action: string;
  cron?: string;
  intervalMs?: number;
  lastRunAt?: string;
  runCount: number;
}

let panel: vscode.WebviewPanel | undefined;
let panelContext: vscode.ExtensionContext | undefined;
let pendingInit: { section?: WorkforceSection; focusAgentId?: string } | undefined;

// v0.11 slice 6 — the Control Center refreshes from the existing event stream (no state store).
const OPERATIONAL_EVENT_PREFIXES = ['run.', 'finding.', 'workflow.', 'eventrule.', 'queue.', 'schedule.', 'employee.', 'execwindow.'];

function isOperationalEventType(type: string): boolean {
  return OPERATIONAL_EVENT_PREFIXES.some(prefix => type.startsWith(prefix));
}

let snapshotTimer: NodeJS.Timeout | undefined;

function scheduleSnapshotRefresh(panelRef: vscode.WebviewPanel): void {
  if (snapshotTimer) {clearTimeout(snapshotTimer);}
  snapshotTimer = setTimeout(() => {
    snapshotTimer = undefined;
    if (panelRef === panel) {pushSnapshot(panelRef);}
  }, 150);
}

function getRunDto(run: Run): RunDto {
  const detail = runDetail(run);
  const plan = detail.plan;
  const employee = detail.employee;
  const windowForRun = getStores().executionWindows.loadAll().find(w => w.runIds.includes(run.id));
  return {
    id: run.id,
    planId: run.planId,
    planTitle: planTitleFor(plan) || run.planId,
    planCode: plan?.id || run.planId,
    planSource: plan?.source?.inputId,
    trigger: detail.trigger,
    agentName: employee?.name || run.agentId || '',
    agentId: run.agentId,
    status: run.status,
    attempts: run.attempts,
    availableAt: run.availableAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    durationMs: detail.durationMs,
    result: run.result,
    error: run.error,
    summary: run.summary,
    mode: queueService.getQueueSettings().workerMode,
    model: employee?.modelProfile?.model || employee?.agentConfig?.model,
    windowId: windowForRun?.id,
    windowName: windowForRun?.name
  };
}

function allRunDtos(): RunDto[] {
  return getStores()
    .runs.loadAll()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(getRunDto);
}

function employeeDtos(): EmployeeDto[] {
  return getStores().people.loadAll().map(e => ({
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

function findingDtos(): FindingDto[] {
  return findingsService.allFindings(200).map(f => {
    const run = f.source?.runId ? getStores().runs.getById(f.source.runId) : undefined;
    const plan = f.planId ? getStores().plans.getById(f.planId) : undefined;
    const planTitle = plan ? planTitleFor(plan) || f.planId : undefined;
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
      planId: f.planId,
      planTitle,
      category: f.category,
      agentValidationState: f.agentValidationState,
      agentReview: f.agentReview
        ? {
            validatorId: f.agentReview.validatorId,
            validatorName: f.agentReview.validatorName,
            recommendation: f.agentReview.recommendation,
            confidence: f.agentReview.confidence,
            reason: f.agentReview.reason,
            validatedAt: f.agentReview.validatedAt
          }
        : undefined
    };
  });
}

function planDtos(): PlanDto[] {
  return getStores()
    .plans.loadAll()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map(p => {
      const title = planTitleFor(p) || p.id;
      const axis = p.classification?.current || p.classification?.original;
      const latestRun = getStores()
        .runs.loadAll()
        .filter(r => r.planId === p.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .pop();
      return {
        id: p.id,
        title,
        status: p.scheduling?.status,
        category: axis?.category || 'research',
        priority: axis?.priority || 'medium',
        assignedAgent: p.execution?.assignedAgent,
        runId: latestRun?.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      };
    });
}

// Title shown for a Request: front-matter `title`, else the first markdown heading,
// else the file name. Create Input writes a `# heading` and dropped files may carry either.
function inputTitle(record: InputRecord): string {
  try {
    const abs = orchestrator.inputArtifactPath(record.id);
    if (abs && fs.existsSync(abs)) {
      const parsed = matter(fs.readFileSync(abs, 'utf8'));
      const fmTitle = (parsed.data as Record<string, unknown>)?.title;
      if (typeof fmTitle === 'string' && fmTitle.trim()) {
        return fmTitle.trim();
      }
      const heading = parsed.content.split('\n').find(line => line.trim().startsWith('# '));
      if (heading) {
        return heading.replace(/^#\s*/, '').trim();
      }
    }
  } catch {
    // unreadable artifact — fall back to the file name
  }
  return path.basename(record.file || record.id);
}

function inputSourceLabel(source: InputRecord['source'] | undefined): string {
  if (!source) {
    return 'human';
  }
  return source.id ? `${source.type}:${source.id}` : source.type;
}

function inputDtos(): InputDto[] {
  return getStores()
    .inputs.loadAll()
    .sort((a, b) => (a.ingestedAt < b.ingestedAt ? 1 : -1))
    .map(i => ({
      id: i.id,
      file: i.file,
      title: inputTitle(i),
      status: i.status,
      source: inputSourceLabel(i.source),
      sourceType: i.source?.type || 'human',
      receivedAt: i.ingestedAt
    }));
}

function checkpointDtos(): CheckpointDto[] {
  return getStores()
    .checkpoints.loadAll()
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .map(cp => ({
      id: cp.id,
      planId: cp.planId,
      planTitle: planTitleFor(getStores().plans.getById(cp.planId)) || cp.planId,
      status: cp.status,
      artifacts: cp.artifacts,
      gitRef: cp.gitRef,
      gitCommit: cp.gitCommit,
      deploymentDecision: cp.deploymentDecision
    }));
}

function cycleDtos(): CycleDto[] {
  return getStores()
    .cycles.loadAll()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map(c => ({
      id: c.id,
      planIds: c.planIds,
      inputIds: c.inputIds,
      outcome: c.outcome,
      startedAt: c.startedAt,
      closedAt: c.closedAt,
      organizationPasses: c.organizationPasses
    }));
}

function eventRuleDtos(): EventRuleDto[] {
  return eventRulesService.getEventRules().map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    matcher: {
      eventType: r.matcher?.eventType,
      source: r.matcher?.source,
      payloadKey: r.matcher?.payloadKey,
      payloadValue: r.matcher?.payloadValue
    },
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    runCount: r.runCount,
    lastTriggeredAt: r.lastTriggeredAt,
    recentTriggers: (r.recentTriggers || []).map(t => ({
      eventId: t.eventId,
      eventType: t.eventType,
      status: t.status,
      createdAt: t.createdAt,
      createdPlanIds: t.createdPlanIds,
      error: t.error
    }))
  }));
}

function workflowDtos(): WorkflowDto[] {
  return getStores().workflows.loadAll().map(w => ({
    id: w.id,
    name: w.name,
    version: w.version,
    enabled: w.enabled,
    updatedAt: w.updatedAt
  }));
}

function executionWindowDtos(): ExecutionWindowDto[] {
  return executionWindowService.getExecutionWindows().map(w => {
    const r = getExecutionWindowReport(w);
    return {
      id: w.id,
      name: w.name,
      goal: w.goal,
      status: w.status,
      createdAt: w.createdAt,
      startedAt: w.startedAt,
      finishedAt: w.finishedAt,
      durationMs: r.durationMs,
      workflowIds: w.workflowIds,
      workflowNames: r.workflowNames,
      agentIds: w.agentIds,
      agentNames: r.agentNames,
      workerMode: w.workerMode,
      maxConcurrentRuns: w.maxConcurrentRuns,
      runCount: r.runCount,
      runs: r.runs,
      planCount: r.planCount,
      findings: r.findings,
      completionSummary: r.completionSummary
    };
  });
}

const EVENT_LABELS: Record<string, string> = {};
EVENT_LABELS['run.queued'] = 'Run queued';
EVENT_LABELS['run.started'] = 'Run started';
EVENT_LABELS['run.retried'] = 'Retry scheduled';
EVENT_LABELS['run.finished'] = 'Run finished';
EVENT_LABELS['run.cancelled'] = 'Run cancelled';
EVENT_LABELS['workflow.started'] = 'Workflow started';
EVENT_LABELS['workflow.completed'] = 'Workflow completed';
EVENT_LABELS['workflow.failed'] = 'Workflow failed';
EVENT_LABELS['finding.created'] = 'Finding created';
EVENT_LABELS['finding.validation.requested'] = 'Agent validation requested';
EVENT_LABELS['finding.validated'] = 'Agent validated finding';
EVENT_LABELS['finding.resolved'] = 'Finding resolved';
EVENT_LABELS['execwindow.created'] = 'Execution window created';
EVENT_LABELS['execwindow.started'] = 'Execution window started';
EVENT_LABELS['execwindow.completed'] = 'Execution window completed';
EVENT_LABELS['execwindow.cancelled'] = 'Execution window cancelled';
EVENT_LABELS['eventrule.created'] = 'Event rule created';
EVENT_LABELS['eventrule.fired'] = 'Event rule fired a workflow';
EVENT_LABELS['eventrule.enabled'] = 'Event rule activated';
EVENT_LABELS['eventrule.disabled'] = 'Event rule paused';
EVENT_LABELS['eventrule.deleted'] = 'Event rule deleted';
EVENT_LABELS['schedule.fired'] = 'Schedule fired';
EVENT_LABELS['schedule.observed'] = 'Schedule occurrence observed';
EVENT_LABELS['approval.requested'] = 'Approval requested';
EVENT_LABELS['approval.resolved'] = 'Approval resolved';
EVENT_LABELS['employee.status'] = 'Employee status';
EVENT_LABELS['queue.skip'] = 'Queue skipped run';

function pickStr(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function eventLink(event: EventRecord): ActivityEventDto['links'] {
  const p = event.payload || {};
  const firstPlan = Array.isArray(p.createdPlanIds) && typeof p.createdPlanIds[0] === 'string' ? p.createdPlanIds[0] : undefined;
  return {
    runId: pickStr(p.runId),
    planId: pickStr(p.planId) || firstPlan,
    workflowId: pickStr(p.workflowId),
    ruleId: pickStr(p.ruleId),
    findingId: pickStr(p.findingId),
    windowId: pickStr(p.windowId),
    scheduleId: pickStr(p.scheduleId),
    employeeId: pickStr(p.employeeId) || pickStr(p.agentId)
  };
}

function activityEventDtos(): ActivityEventDto[] {
  return getActivitySummary().recentEvents.map(event => ({
    id: event.id,
    type: event.type,
    source: event.source,
    timestamp: event.timestamp,
    label: EVENT_LABELS[event.type] || event.type,
    links: eventLink(event)
  }));
}

function toApprovalDto(a: Approval): ApprovalDto {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    reason: a.reason,
    target: a.target,
    requesterId: a.requesterId,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt,
    decisionBy: a.decisionBy
  };
}

function approvalDtos(): ApprovalDto[] {
  return getStores()
    .approvals.loadAll()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 25)
    .map(toApprovalDto);
}

function approvalDtoById(id: string): ApprovalDto | undefined {
  const approval = getStores().approvals.loadAll().find(a => a.id === id);
  return approval ? toApprovalDto(approval) : undefined;
}

function toProposalDto(p: Proposal): ProposalDto {
  return {
    id: p.id,
    findingId: p.findingId,
    title: p.title,
    type: p.type,
    priority: p.priority,
    ...(p.workflow ? { workflow: p.workflow } : {}),
    ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
    status: p.status,
    createdAt: p.createdAt,
    ...(p.appliedPlanId ? { appliedPlanId: p.appliedPlanId } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    ...(p.editedAt ? { editedAt: p.editedAt } : {}),
    ...(p.edits && p.edits.length > 0 ? { editCount: p.edits.length } : {}),
    ...(p.requeuedAt ? { requeuedAt: p.requeuedAt } : {})
  };
}

function proposalDtos(): ProposalDto[] {
  return getStores()
    .proposals.loadAll()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 25)
    .map(toProposalDto);
}

function scheduleDtos(): ScheduleDto[] {
  return getStores().schedules.loadAll().map((s: ScheduleRecord) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    kind: s.kind,
    autonomyLevel: s.autonomyLevel,
    action: s.action ?? 'plan',
    cron: s.cron,
    intervalMs: s.intervalMs,
    lastRunAt: s.lastRunAt,
    runCount: s.runCount
  }));
}

function pushRun(panelRef: vscode.WebviewPanel, run: Run): void {
  const message = { command: 'RUN_UPDATED', payload: { run: getRunDto(run) } };
  try {
    panelRef.webview.postMessage(message);
  } catch {
    // panel may be disposed mid-flight
  }
}

function pushProposalPatch(panelRef: vscode.WebviewPanel, proposal: Proposal): void {
  try {
    panelRef.webview.postMessage({ command: 'PROPOSAL_UPDATED', payload: { proposal: toProposalDto(proposal) } });
  } catch {
    // panel may be disposed mid-flight
  }
}

function pushSnapshot(panelRef: vscode.WebviewPanel): void {
  const overview = getActivitySummary();
  const counts = {
    pendingApprovals: getStores().approvals.loadAll().filter(a => a.status === 'pending').length,
    pendingFindings: findingsService.pendingFindingCount(),
    ...findingsService.getFindingReviewCounts(),
    proposals: getStores().proposals.loadAll().length,
    schedules: getStores().schedules.loadAll().length,
    workflows: getStores().workflows.loadAll().length,
    eventRules: getStores().eventRules.loadAll().length,
    exeWindows: getStores().executionWindows.loadAll().length
  };
  try {
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_OVERVIEW', payload: { overview } });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_COUNTS', payload: counts });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_QUEUE', payload: getQueueSnapshot() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_EMPLOYEES', payload: employeeDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_PLANS', payload: planDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_INPUTS', payload: inputDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_CHECKPOINTS', payload: checkpointDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_CYCLES', payload: cycleDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_RUNS', payload: allRunDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_FINDINGS', payload: findingDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_EVENT_RULES', payload: eventRuleDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_WORKFLOWS', payload: workflowDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_EXEC_WINDOWS', payload: executionWindowDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_ACTIVITY', payload: activityEventDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_APPROVALS', payload: approvalDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_SCHEDULES', payload: scheduleDtos() });
    panelRef.webview.postMessage({ command: 'SET_WORKFORCE_PROPOSALS', payload: proposalDtos() });
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

async function handleCreateInput(message: any, panelRef: vscode.WebviewPanel): Promise<void> {
  const { requestId, payload } = message;
  const title: string | undefined = payload?.title;
  if (!title || !String(title).trim()) {
    postResponse(panelRef, requestId, undefined, 'Input title is required');
    return;
  }

  const ws = fileService.getWorkspaceRoot();
  if (!ws) {
    postResponse(panelRef, requestId, undefined, 'No workspace is open');
    return;
  }

  try {
    const safeTitle = String(title)
      .trim()
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    const inputDir = orchestrator.inputsDir(ws);
    fs.mkdirSync(inputDir, { recursive: true });
    const filename = `${safeTitle || 'input'}-${Date.now()}.md`;
    const filePath = path.join(inputDir, filename);

    // Front-matter carries the classification axes the Orchestrator reads
    // (title/objective drive decomposition, priority seeds classification.original);
    // the body stays human-readable.
    const frontMatter: Record<string, string> = {
      title: String(title).trim(),
      objective: String(title).trim(),
      source: payload?.source ? String(payload.source) : 'human'
    };
    if (payload?.priority) {
      frontMatter.priority = String(payload.priority);
    }
    if (payload?.category) {
      frontMatter.category = String(payload.category);
    }

    const lines: string[] = [`# ${String(title).trim()}`, ''];
    if (payload?.description) {
      lines.push(String(payload.description).trim(), '');
    }
    fs.writeFileSync(filePath, matter.stringify(lines.join('\n'), frontMatter), 'utf-8');

    const input = orchestrator.ingestInput(filePath, { source: { type: 'human', id: 'control-center' } });
    workforceTreeDataProvider.refresh();
    postResponse(panelRef, requestId, { input, inputFile: input.file });
  } catch (error) {
    postResponse(panelRef, requestId, undefined, error instanceof Error ? error.message : String(error));
  }
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

  const unsubscribeEvents = subscribeEvents(event => {
    if (isOperationalEventType(event.type)) {scheduleSnapshotRefresh(newPanel);}
  });

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
      } else if (command === 'WORKFORCE_CREATE_INPUT') {
        await handleCreateInput(message, newPanel);
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_RUN_ORGANIZER') {
        const ws = fileService.getWorkspaceRoot();
        if (!ws) {
          postResponse(newPanel, message?.requestId, undefined, 'No workspace is open');
        } else {
          try {
            const result = organizer.runOrganizerPass({ workspaceRoot: ws });
            postResponse(newPanel, message?.requestId, result);
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_APPROVE_CHECKPOINT_DEPLOY' || command === 'WORKFORCE_REJECT_CHECKPOINT_DEPLOY') {
        const checkpointId: string | undefined = message?.payload?.checkpointId;
        const actorId: string | undefined =
          typeof message?.payload?.actorId === 'string' ? message.payload.actorId : undefined;
        if (!checkpointId) {
          postResponse(newPanel, message?.requestId, undefined, 'checkpointId is required');
        } else {
          try {
            const checkpoint = getStores().checkpoints.getById(checkpointId);
            if (!checkpoint) {
              postResponse(newPanel, message?.requestId, undefined, `Checkpoint not found: ${checkpointId}`);
            } else if (checkpoint.status !== 'deployment-authorizing') {
              postResponse(newPanel, message?.requestId, undefined, `Checkpoint ${checkpointId} is not awaiting deploy authorization (current: ${checkpoint.status})`);
            } else {
              const pending = getStores()
                .approvals.pending()
                .find(p => p.pending?.op === 'authorize-deploy' && p.pending.checkpointId === checkpoint.id);
              if (!pending) {
                postResponse(newPanel, message?.requestId, undefined, `No pending deploy authorization found for checkpoint ${checkpointId}`);
              } else {
                const resolved =
                  command === 'WORKFORCE_APPROVE_CHECKPOINT_DEPLOY'
                    ? approvals.approve(pending.id, actorId)
                    : approvals.reject(pending.id, actorId);
                if (!resolved) {
                  postResponse(newPanel, message?.requestId, undefined, 'No pending approval found for checkpoint');
                } else {
                  postResponse(newPanel, message?.requestId, {
                    resolved: true,
                    checkpointId,
                    approvalId: pending.id,
                    approval: toApprovalDto(resolved)
                  });
                }
              }
            }
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_CANCEL_RUN') {
        const runId: string | undefined = message?.payload?.runId;
        if (runId) {
          try {
            const cancelled = queueService.cancelRun(runId);
            if (cancelled) {
              pushRun(newPanel, cancelled);
              postResponse(newPanel, message?.requestId, { cancelled: true, run: getRunDto(cancelled) });
            } else {
              postResponse(newPanel, message?.requestId, undefined, 'Run not cancellable (already finished or missing)');
            }
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
              const dto = findingDtos().find(f => f.id === findingId);
              newPanel.webview.postMessage({
                command: 'FINDING_UPDATED',
                payload: { finding: dto }
              });
              postResponse(newPanel, message?.requestId, { decided: true, findingId, decision, finding: dto });
            } else {
              postResponse(newPanel, message?.requestId, undefined, 'Finding not found or already resolved');
            }
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_RESOLVE_APPROVAL') {
        const approvalId: string | undefined = message?.payload?.approvalId;
        const decision: string | undefined = message?.payload?.decision;
        const actorId: string | undefined =
          typeof message?.payload?.actorId === 'string' ? message.payload.actorId : undefined;
        if (approvalId && (decision === 'approved' || decision === 'rejected')) {
          try {
            const resolved =
              decision === 'approved'
                ? approvals.approve(approvalId, actorId)
                : approvals.reject(approvalId, actorId);
            if (resolved) {
              const dto = approvalDtoById(approvalId);
              newPanel.webview.postMessage({
                command: 'APPROVAL_UPDATED',
                payload: { approval: dto }
              });
              postResponse(newPanel, message?.requestId, { resolved: true, approvalId, decision, approval: dto });
            } else {
              postResponse(newPanel, message?.requestId, undefined, `No pending approval found for ${approvalId}`);
            }
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
        } else if (command === 'WORKFORCE_VALIDATE_FINDING') {
        const findingId: string | undefined = message?.payload?.findingId;
        const recommendation: string | undefined = message?.payload?.recommendation;
        if (
          findingId &&
          (recommendation === 'recommend-approve' || recommendation === 'recommend-reject' || recommendation === 'request-revision')
        ) {
          const validatorId: string | undefined = message?.payload?.validatorId;
          const confidence: number | undefined =
            typeof message?.payload?.confidence === 'number' && Number.isFinite(message.payload.confidence)
              ? message.payload.confidence
              : undefined;
          const reason: string | undefined = typeof message?.payload?.reason === 'string' ? message.payload.reason : undefined;
          try {
            const updated = findingsService.validateFinding(
              findingId,
              { recommendation, confidence, reason },
              validatorId
            );
            if (updated) {
              const dto = findingDtos().find(f => f.id === findingId);
              newPanel.webview.postMessage({
                command: 'FINDING_UPDATED',
                payload: { finding: dto }
              });
              postResponse(newPanel, message?.requestId, { validated: true, findingId, finding: dto });
            } else {
              postResponse(newPanel, message?.requestId, undefined, 'Finding not found or already validated');
            }
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        } else if (command === 'WORKFORCE_CREATE_EXEC_WINDOW') {
        const payload = message?.payload || {};
        const name = String(payload.name || '').trim();
        const workflowIds = Array.isArray(payload.workflowIds)
          ? payload.workflowIds.map((x: unknown) => String(x)).filter(Boolean)
          : [];
        const agentIds = Array.isArray(payload.agentIds)
          ? payload.agentIds.map((x: unknown) => String(x)).filter(Boolean)
          : [];
        const workerMode: WorkerMode | undefined =
          typeof payload.workerMode === 'string' &&
          ['headless', 'terminal', 'noop', 'ollama'].includes(payload.workerMode)
            ? payload.workerMode
            : undefined;
        const maxConcurrentRuns: number | undefined =
          typeof payload.maxConcurrentRuns === 'number' && Number.isFinite(payload.maxConcurrentRuns)
            ? payload.maxConcurrentRuns
            : undefined;
        if (!name || workflowIds.length === 0) {
          postResponse(newPanel, message?.requestId, undefined, 'Window name and at least one workflow are required');
        } else {
          try {
            const created = executionWindowService.createExecutionWindow({
              name,
              goal: payload.goal,
              workflowIds,
              agentIds,
              workerMode,
              maxConcurrentRuns
            });
            postResponse(newPanel, message?.requestId, { window: executionWindowDtos().find(d => d.id === created.id) });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_START_EXEC_WINDOW') {
        const windowId: string | undefined = message?.payload?.windowId;
        if (windowId) {
          try {
            const started = await executionWindowService.startExecutionWindow(windowId);
            postResponse(newPanel, message?.requestId, { started: true, window: executionWindowDtos().find(d => d.id === started.id) });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_CANCEL_EXEC_WINDOW') {
        const windowId: string | undefined = message?.payload?.windowId;
        if (windowId) {
          try {
            const cancelled = executionWindowService.cancelExecutionWindow(windowId);
            postResponse(newPanel, message?.requestId, { cancelled: true, window: executionWindowDtos().find(d => d.id === cancelled.id) });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_RETRY_RUN') {
        const runId: string | undefined = message?.payload?.runId;
        const existing = runId ? getStores().runs.getById(runId) : undefined;
        if (existing && ['failed', 'cancelled', 'completed'].includes(existing.status)) {
          try {
            const created = queueService.createRun(existing.planId, existing.agentId, { actor: 'control-center' });
            pushRun(newPanel, created);
            postResponse(newPanel, message?.requestId, { retried: true, run: getRunDto(created) });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
          workforceTreeDataProvider.refresh();
          pushSnapshot(newPanel);
        }
      } else if (command === 'WORKFORCE_PROCESS_QUEUE') {
        try {
          const result = queueService.processQueue({ dryRun: false });
          postResponse(newPanel, message?.requestId, {
            queueProcessed: true,
            claimed: result.claims.length,
            started: result.started.length,
            skipped: result.skipped.length
          });
        } catch (error) {
          postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_RUN_CLASSIFICATION') {
        try {
          const result = await classificationService.runClassificationPass({
            classifyWithLlm: message?.payload?.classifyWithLlm
          });
          postResponse(newPanel, message?.requestId, result);
        } catch (error) {
          postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_APPLY_PROPOSAL' || command === 'WORKFORCE_REJECT_PROPOSAL' || command === 'WORKFORCE_EDIT_PROPOSAL' || command === 'WORKFORCE_REQUEUE_PROPOSAL') {
        const proposalId: string | undefined = message?.payload?.proposalId;
        try {
          if (!proposalId) {throw new Error('proposalId is required');}
          let proposal: Proposal | undefined;
          let done: string;
          if (command === 'WORKFORCE_APPLY_PROPOSAL') {
            proposal = classificationService.applyProposal(proposalId);
            done = 'applied';
          } else if (command === 'WORKFORCE_REJECT_PROPOSAL') {
            proposal = classificationService.rejectProposal(proposalId);
            done = 'rejected';
          } else if (command === 'WORKFORCE_EDIT_PROPOSAL') {
            proposal = classificationService.editProposal(proposalId, message?.payload?.changes || {});
            done = 'edited';
          } else {
            proposal = classificationService.requeueProposal(proposalId);
            done = 'requeued';
          }
          if (!proposal) {throw new Error('proposal not found');}
          postResponse(newPanel, message?.requestId, { [done]: true, proposal: toProposalDto(proposal) });
          pushProposalPatch(newPanel, proposal);
        } catch (error) {
          postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_UPDATE_AGENT') {
        const employeeId: string | undefined = message?.payload?.employeeId;
        const change = message?.payload?.change || {};
        const changes: workforceService.EmployeeConfigChange = {};

        if (change?.modelProfile && typeof change.modelProfile.model === 'string' && change.modelProfile.model.trim()) {
          const mp: EmployeeModelProfile = {
            name: getStores().people.getById(employeeId || '')?.name || employeeId || '',
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
      } else if (command === 'WORKFORCE_CREATE_EVENT_RULE') {
        const payload = message?.payload || {};
        const name = String(payload.name || '').trim();
        const workflowId = String(payload.workflowId || '').trim();
        if (!name || !workflowId) {
          postResponse(newPanel, message?.requestId, undefined, 'Event rule name and workflow are required');
          return;
        }
        try {
          const created = eventRulesService.createEventRule({
            name,
            description: payload.description,
            matcher: {
              eventType: payload.matcher?.eventType,
              source: payload.matcher?.source,
              payloadKey: payload.matcher?.payloadKey,
              payloadValue: payload.matcher?.payloadValue
            },
            workflowId
          });
          postResponse(newPanel, message?.requestId, { rule: eventRuleDtos().find(r => r.id === created.id) });
        } catch (error) {
          postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_SET_EVENT_RULE_ENABLED') {
        const ruleId: string | undefined = message?.payload?.ruleId;
        const enabled = Boolean(message?.payload?.enabled);
        if (ruleId) {
          try {
            eventRulesService.setEventRuleEnabled(ruleId, enabled);
            postResponse(newPanel, message?.requestId, { ok: true });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      } else if (command === 'WORKFORCE_DELETE_EVENT_RULE') {
        const ruleId: string | undefined = message?.payload?.ruleId;
        if (ruleId) {
          try {
            const deleted = eventRulesService.deleteEventRule(ruleId);
            postResponse(newPanel, message?.requestId, { deleted });
          } catch (error) {
            postResponse(newPanel, message?.requestId, undefined, error instanceof Error ? error.message : String(error));
          }
        }
        workforceTreeDataProvider.refresh();
        pushSnapshot(newPanel);
      }
    },
    undefined,
    context.subscriptions
  );

  newPanel.onDidDispose(
    () => {
      if (panel === newPanel) {
        unsubscribeEvents();
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