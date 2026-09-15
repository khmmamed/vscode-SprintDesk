// src/webview/workforce/WorkforceControlCenter.tsx
import * as React from "react";
import { acquireVsCodeApiOnce } from "../vscodeApi";

type WorkforceSection =
  | "employees"
  | "tasks"
  | "runs"
  | "findings"
  | "proposals"
  | "approvals"
  | "schedules"
  | "workflows"
  | "event-rules"
  | "windows"
  | "activity"
  | "create-task";

type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type RunFilter = RunStatus | "retrying" | "all";
type FindingFilter = "all" | "agent" | "human" | "approved" | "rejected";
type FindingStatus = "pending" | "approved" | "rejected";
type WorkerMode = "headless" | "terminal" | "noop" | "ollama";
type RuleTriggerStatus = "completed" | "failed";
type ExecWindowStatus = "planned" | "running" | "completed" | "cancelled";

interface RunDto {
  id: string;
  taskId: string;
  taskTitle: string;
  taskCode: string;
  taskSource?: string;
  taskWorkflow?: string;
  trigger?: { ruleId: string; ruleName: string; eventType: string };
  agentName: string;
  agentId?: string;
  status: RunStatus;
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

interface QueueDto {
  asOf: string;
  runs: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  waitingRetry: number;
  multiAttempt: number;
  workerMode: WorkerMode;
  maxConcurrentRuns: number;
  allocated: number;
  busyEmployees: number;
  idleAgents: number;
  offlineAgents: number;
}

interface EmployeeDto {
  id: string;
  name: string;
  role: "agent" | "human";
  status?: "idle" | "busy" | "offline";
  capabilities: string[];
  modelProfile?: { provider?: string; model?: string; baseUrl?: string };
  agentConfig?: { tool?: string; command?: string; model?: string };
  permissions: string[];
}

interface OverviewDto {
  runs: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  employees: { total: number; agents: number; idle: number; busy: number; offline: number };
}

interface CountsDto {
  pendingApprovals: number;
  pendingFindings: number;
  pendingAgentReview: number;
  pendingHumanReview: number;
  proposals: number;
  schedules: number;
  workflows: number;
  eventRules: number;
  exeWindows: number;
}

interface ExecutionWindowDto {
  id: string;
  name: string;
  goal?: string;
  status: ExecWindowStatus;
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
  taskCount: number;
  findings: { total: number; pendingAgentReview: number; pendingHumanReview: number; approved: number; rejected: number };
  completionSummary?: { runsCompleted: number; runsFailed: number; runsCancelled: number; findings: number; errors: number };
}

interface EventRuleMatcherDto {
  eventType?: string;
  source?: string;
  payloadKey?: string;
  payloadValue?: string;
}

interface EventRuleTriggerDto {
  eventId: string;
  eventType: string;
  status: RuleTriggerStatus;
  createdAt: string;
  createdTaskIds?: string[];
  error?: string;
}

interface EventRuleDto {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  matcher: EventRuleMatcherDto;
  workflowId: string;
  workflowName?: string;
  runCount: number;
  lastTriggeredAt?: string;
  recentTriggers: EventRuleTriggerDto[];
}

interface WorkflowDto {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  updatedAt: string;
}

interface TaskDto {
  id: string;
  title: string;
  code: string;
  status: string;
  workStatus?: string;
  priority?: string;
  agent?: string;
}

interface ActivityEventDto {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  label: string;
  links: {
    runId?: string;
    taskId?: string;
    workflowId?: string;
    ruleId?: string;
    findingId?: string;
    windowId?: string;
    scheduleId?: string;
    employeeId?: string;
  };
}

interface ApprovalDto {
  id: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  target: string;
  requesterId?: string;
  createdAt: string;
  resolvedAt?: string;
  decisionBy?: string;
}

interface ProposalDto {
  id: string;
  findingId: string;
  title: string;
  type: string;
  priority: string;
  workflow?: string;
  confidence?: number;
  status: string;
  createdAt: string;
  appliedTaskId?: string;
  reason?: string;
  editedAt?: string;
  editCount?: number;
  requeuedAt?: string;
}

interface ScheduleDto {
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

interface FindingDto {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  confidence?: number;
  status: FindingStatus;
  agentId: string;
  agentName: string;
  timestamp: string;
  runId: string;
  runStatus?: RunStatus;
  taskId?: string;
  taskTitle?: string;
  category?: string;
  agentValidationState?: "requested" | "validated";
  agentReview?: {
    validatorId: string;
    validatorName?: string;
    recommendation: "recommend-approve" | "recommend-reject" | "request-revision";
    confidence?: number;
    reason?: string;
    validatedAt: string;
  };
}

const EMPTY_OVERVIEW: OverviewDto = {
  runs: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
  employees: { total: 0, agents: 0, idle: 0, busy: 0, offline: 0 }
};

const EMPTY_QUEUE: QueueDto = {
  asOf: "",
  runs: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
  waitingRetry: 0,
  multiAttempt: 0,
  workerMode: "headless",
  maxConcurrentRuns: 0,
  allocated: 0,
  busyEmployees: 0,
  idleAgents: 0,
  offlineAgents: 0
};

const EMPTY_COUNTS: CountsDto = { pendingApprovals: 0, pendingFindings: 0, pendingAgentReview: 0, pendingHumanReview: 0, proposals: 0, schedules: 0, workflows: 0, eventRules: 0, exeWindows: 0 };

const TABS: Array<{ key: WorkforceSection; label: string }> = [
  { key: "employees", label: "Employees" },
  { key: "tasks", label: "Tasks" },
  { key: "runs", label: "Runs" },
  { key: "findings", label: "Findings" },
  { key: "proposals", label: "Proposals" },
  { key: "approvals", label: "Approvals" },
  { key: "schedules", label: "Schedules" },
  { key: "workflows", label: "Workflows" },
  { key: "event-rules", label: "Event Rules" },
  { key: "windows", label: "Execution Windows" },
  { key: "activity", label: "Activity" },
  { key: "create-task", label: "Create Task" }
];

const MODES: Array<{ value: WorkerMode; label: string; hint: string }> = [
  { value: "ollama", label: "Ollama (LLM)", hint: "Run via the configured model provider" },
  { value: "headless", label: "Headless", hint: "Spawn agentConfig.tool as a background process" },
  { value: "terminal", label: "Terminal", hint: "Run the agent in the integrated terminal" },
  { value: "noop", label: "Noop (dry run)", hint: "Simulate completion, no real execution" }
];

const TYPE_CHOICES = ["feature", "bug", "chore", "doc", "test"];
const PRIORITY_CHOICES = ["low", "medium", "high"];

const RUN_FILTER_OPTIONS: Array<{ key: RunFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "retrying", label: "Retrying" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" }
];

const FINDING_FILTER_OPTIONS: Array<{ key: FindingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "agent", label: "Agent Review" },
  { key: "human", label: "Human Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" }
];

function post(msg: any): void {
  try {
    acquireVsCodeApiOnce().postMessage(msg);
  } catch {
    // webview not attached (dev server)
  }
}

function postRequest(command: string, payload?: any): void {
  post({ command, payload });
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case "running": return "#4caf50";
    case "queued": return "#ffb74d";
    case "completed": return "#4caf50";
    case "failed": return "#e53935";
    case "cancelled": return "#9e9e9e";
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined || !isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

function isRetrying(run: RunDto): boolean {
  return run.status === "queued" && !!run.availableAt && new Date(run.availableAt).getTime() > Date.now();
}

function reviewStateLabel(f: FindingDto): string {
  if (f.status === "approved") return "approved";
  if (f.status === "rejected") return "rejected";
  return f.agentReview ? "pending human review" : "pending agent review";
}

function severityColor(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "high": return "#e53935";
    case "medium": return "#ffb74d";
    case "low": return "#4caf50";
  }
}

function recommendationColor(recommendation: "recommend-approve" | "recommend-reject" | "request-revision"): string {
  switch (recommendation) {
    case "recommend-approve": return "#4caf50";
    case "recommend-reject": return "#e53935";
    case "request-revision": return "#ffb74d";
  }
}

function recommendationLabel(recommendation: "recommend-approve" | "recommend-reject" | "request-revision"): string {
  switch (recommendation) {
    case "recommend-approve": return "recommend approve";
    case "recommend-reject": return "recommend reject";
    case "request-revision": return "request revision";
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: { fontFamily: "var(--vscode-font-family)", padding: 12 },
  header: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  subtitle: { color: "#9ca3af", fontSize: 12 },
  statRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  stat: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    backgroundColor: "var(--vscode-button-secondaryBackground, #2f3a4b)",
    color: "var(--vscode-button-secondaryForeground, #fff)"
  },
  statButton: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    cursor: "pointer",
    border: "none",
    backgroundColor: "var(--vscode-button-secondaryBackground, #2f3a4b)",
    color: "var(--vscode-button-secondaryForeground, #fff)"
  },
  filterRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  filterChip: {
    fontSize: 12,
    padding: "2px 10px",
    border: "1px solid var(--vscode-panel-border, #333)",
    borderRadius: 10,
    cursor: "pointer",
    background: "transparent",
    color: "var(--vscode-foreground, #ccc)"
  },
  filterChipActive: {
    fontSize: 12,
    padding: "2px 10px",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    backgroundColor: "var(--vscode-button-background, #0e7b6f)",
    color: "var(--vscode-button-foreground, #fff)"
  },
  tabs: { display: "flex", gap: 2, flexWrap: "wrap", borderBottom: "1px solid var(--vscode-panel-border, #333)", marginBottom: 12 },
  tab: {
    padding: "6px 12px",
    border: "none",
    background: "transparent",
    color: "var(--vscode-foreground, #ccc)",
    cursor: "pointer",
    fontSize: 13,
    borderBottom: "2px solid transparent"
  },
  tabActive: {
    borderBottom: "2px solid var(--vscode-focusBorder, #4fc1ff)",
    color: "var(--vscode-foreground, #fff)"
  },
  card: {
    border: "1px solid var(--vscode-panel-border, #333)",
    borderRadius: 6,
    padding: "8px 10px",
    marginBottom: 8
  },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontWeight: 600, fontSize: 13 },
  muted: { color: "#9ca3af", fontSize: 12 },
  chip: {
    fontSize: 11,
    padding: "1px 8px",
    borderRadius: 4,
    backgroundColor: "var(--vscode-badge-background, #3a3a3a)",
    color: "var(--vscode-badge-foreground, #fff)"
  },
  statusChip: { fontSize: 11, padding: "1px 8px", borderRadius: 4, backgroundColor: "#2f3a4b", color: "#fff" },
  output: {
    marginTop: 8,
    padding: 8,
    borderRadius: 4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 12,
    maxHeight: 220,
    overflow: "auto",
    backgroundColor: "var(--vscode-textBlockQuote-background, #1e1e1e)",
    color: "var(--vscode-foreground, #ccc)"
  },
  detail: {
    marginTop: 8,
    fontSize: 12,
    display: "flex",
    flexDirection: "column",
    gap: 3
  },
  button: {
    fontSize: 12,
    padding: "4px 12px",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    backgroundColor: "var(--vscode-button-background, #0e7b6f)",
    color: "var(--vscode-button-foreground, #fff)"
  },
  buttonGhost: {
    fontSize: 12,
    padding: "4px 10px",
    border: "1px solid var(--vscode-panel-border, #333)",
    borderRadius: 4,
    cursor: "pointer",
    background: "transparent",
    color: "var(--vscode-foreground, #ccc)"
  },
  field: { marginBottom: 10 },
  label: { display: "block", fontSize: 12, marginBottom: 4, color: "#9ca3af" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontSize: 13,
    background: "var(--vscode-input-background, #1e1e1e)",
    color: "var(--vscode-input-foreground, #fff)",
    border: "1px solid var(--vscode-input-border, #333)",
    borderRadius: 4
  },
  select: {
    width: "100%",
    padding: "6px 8px",
    fontSize: 13,
    background: "var(--vscode-input-background, #1e1e1e)",
    color: "var(--vscode-input-foreground, #fff)",
    border: "1px solid var(--vscode-input-border, #333)",
    borderRadius: 4
  },
  empty: { color: "#9ca3af", fontSize: 13, padding: "16px 4px" },
  error: { color: "#e53935", fontSize: 12, marginBottom: 8 },
  ok: { color: "#4caf50", fontSize: 12, marginBottom: 8 },
  cardFocused: {
    border: "1px solid var(--vscode-focusBorder, #4fc1ff)",
    borderRadius: 6,
    padding: "8px 10px",
    marginBottom: 8
  },
  link: {
    display: "inline-flex",
    fontSize: 11,
    padding: "1px 8px",
    marginLeft: 4,
    borderRadius: 4,
    border: "1px solid var(--vscode-focusBorder, #4fc1ff)",
    color: "var(--vscode-focusBorder, #4fc1ff)",
    cursor: "pointer",
    background: "transparent"
  },
  ticker: {
    fontSize: 11,
    color: "#9ca3af",
    padding: "4px 8px",
    border: "1px solid var(--vscode-panel-border, #333)",
    borderRadius: 4,
    marginBottom: 4
  },
  loading: { fontSize: 12, color: "#9ca3af", padding: "8px 4px" }
};

export const WorkforceControlCenter: React.FunctionComponent = () => {
  const [tab, setTab] = React.useState<WorkforceSection>("runs");
  const [loaded, setLoaded] = React.useState(false);
  const [runs, setRuns] = React.useState<RunDto[]>([]);
  const [tasks, setTasks] = React.useState<TaskDto[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeDto[]>([]);
  const [findings, setFindings] = React.useState<FindingDto[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalDto[]>([]);
  const [schedules, setSchedules] = React.useState<ScheduleDto[]>([]);
  const [activity, setActivity] = React.useState<ActivityEventDto[]>([]);
  const [overview, setOverview] = React.useState<OverviewDto>(EMPTY_OVERVIEW);
  const [counts, setCounts] = React.useState<CountsDto>(EMPTY_COUNTS);
  const [queue, setQueue] = React.useState<QueueDto>(EMPTY_QUEUE);
  const [runFilter, setRunFilter] = React.useState<RunFilter>("all");
  const [findingFilter, setFindingFilter] = React.useState<FindingFilter>("all");
  const [queueResult, setQueueResult] = React.useState<string>("");
  const [proposals, setProposals] = React.useState<ProposalDto[]>([]);
  const [classifyResult, setClassifyResult] = React.useState<string>("");
  const [runAction, setRunAction] = React.useState<string>("");
  const [runActionError, setRunActionError] = React.useState<string>("");
  const [findingAction, setFindingAction] = React.useState<string>("");
  const [findingActionError, setFindingActionError] = React.useState<string>("");
  const [approvalAction, setApprovalAction] = React.useState<string>("");
  const [approvalActionError, setApprovalActionError] = React.useState<string>("");
  const [proposalAction, setProposalAction] = React.useState<string>("");
  const [proposalActionError, setProposalActionError] = React.useState<string>("");
  const [taskAction, setTaskAction] = React.useState<string>("");
  const [taskActionError, setTaskActionError] = React.useState<string>("");
  const [editingTask, setEditingTask] = React.useState<TaskDto | null>(null);
  const [confirmDeleteTask, setConfirmDeleteTask] = React.useState<string | null>(null);
  const [taskEditForm, setTaskEditForm] = React.useState<{
    title: string;
    status: string;
    priority: string;
    agent: string;
  }>({ title: "", status: "waiting", priority: "medium", agent: "" });

  const [editingProposal, setEditingProposal] = React.useState<ProposalDto | null>(null);
  const [proposalEditForm, setProposalEditForm] = React.useState<{
    title: string;
    type: string;
    priority: string;
    workflow: string;
  }>({ title: "", type: "feature", priority: "medium", workflow: "" });

  const [runFocus, setRunFocus] = React.useState<string | null>(null);
  const [findingFocus, setFindingFocus] = React.useState<string | null>(null);
  const [windowFocus, setWindowFocus] = React.useState<string | null>(null);
  const [workflowFocus, setWorkflowFocus] = React.useState<string | null>(null);
  const [ruleFocus, setRuleFocus] = React.useState<string | null>(null);
  const [employeeFocus, setEmployeeFocus] = React.useState<string | null>(null);
  const [taskFocus, setTaskFocus] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<{
    title: string;
    type: string;
    priority: string;
    backlog: string;
    agentId: string;
    runMode: WorkerMode;
  }>({ title: "", type: "research", priority: "medium", backlog: "", agentId: "", runMode: "ollama" });

  const [busy, setBusy] = React.useState<"idle" | "running" | "done" | "error">("idle");
  const [outcome, setOutcome] = React.useState<any>(null);
  const [error, setError] = React.useState<string>("");
  const [expandedRun, setExpandedRun] = React.useState<string | null>(null);

  const [editingAgent, setEditingAgent] = React.useState<EmployeeDto | null>(null);
  const [configForm, setConfigForm] = React.useState<{
    provider: string;
    model: string;
    baseUrl: string;
    tool: string;
    command: string;
    capabilities: string;
  }>({ provider: "", model: "", baseUrl: "", tool: "", command: "", capabilities: "" });
  const [configResult, setConfigResult] = React.useState<string>("");

  const [eventRules, setEventRules] = React.useState<EventRuleDto[]>([]);
  const [workflows, setWorkflows] = React.useState<WorkflowDto[]>([]);
  const [execWindows, setExecWindows] = React.useState<ExecutionWindowDto[]>([]);
  const [windowError, setWindowError] = React.useState<string>("");
  const [windowResult, setWindowResult] = React.useState<string>("");
  const [expandedWindow, setExpandedWindow] = React.useState<string | null>(null);
  const [windowForm, setWindowForm] = React.useState<{
    name: string;
    goal: string;
    workflowIds: string[];
    agentIds: string[];
    workerMode: string;
  }>({ name: "", goal: "", workflowIds: [], agentIds: [], workerMode: "" });
  const [ruleError, setRuleError] = React.useState<string>("");
  const [ruleResult, setRuleResult] = React.useState<string>("");
  const [ruleForm, setRuleForm] = React.useState<{
    name: string;
    description: string;
    eventType: string;
    source: string;
    payloadKey: string;
    payloadValue: string;
    workflowId: string;
  }>({ name: "", description: "", eventType: "", source: "", payloadKey: "", payloadValue: "", workflowId: "" });

  const [validateFor, setValidateFor] = React.useState<FindingDto | null>(null);
  const [validateError, setValidateError] = React.useState<string>("");
  const [validateForm, setValidateForm] = React.useState<{
    validatorId: string;
    recommendation: string;
    confidence: string;
    reason: string;
  }>({ validatorId: "", recommendation: "recommend-approve", confidence: "0.9", reason: "" });

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload, error: messageError } = event.data || {};
      if (command === "SET_WORKFORCE_INIT") {
        if (payload?.section) setTab(payload.section);
        if (payload?.focusAgentId) {
          setForm(prev => ({ ...prev, agentId: payload.focusAgentId }));
          setTab("create-task");
        }
      } else if (command === "SET_WORKFORCE_RUNS") {
        setRuns(payload || []);
      } else if (command === "SET_WORKFORCE_TASKS") {
        setTasks(payload || []);
      } else if (command === "TASK_UPDATED") {
        const task: TaskDto | undefined = payload?.task;
        if (task) {
          setTasks(prev => [task, ...(prev || []).filter(t => t.id !== task.id)]);
          setEditingTask(null);
          setConfirmDeleteTask(null);
        }
      } else if (command === "SET_WORKFORCE_EMPLOYEES") {
        setEmployees(payload || []);
      } else if (command === "AGENT_CONFIGURED") {
        const outcomePayload = payload?.outcome;
        const emp: EmployeeDto | undefined = payload?.employee;
        if (emp) {
          setEmployees(prev => (prev || []).map(e => (e.id === emp.id ? emp : e)));
        }
        setConfigResult(
          outcomePayload?.applied
            ? "Saved."
            : outcomePayload?.approvalRequired
              ? "Approval required — the change stays pending until approved."
              : ""
        );
      } else if (command === "SET_WORKFORCE_FINDINGS") {
        setFindings(payload || []);
      } else if (command === "FINDING_UPDATED") {
        const finding: FindingDto | undefined = payload?.finding;
        if (finding) {
          setFindings(prev => [finding, ...(prev || []).filter(f => f.id !== finding.id)]);
          if (finding.agentReview) setValidateFor(null);
        }
      } else if (command === "SET_WORKFORCE_OVERVIEW") {
        if (payload?.overview) setOverview(payload.overview);
        setLoaded(true);
      } else if (command === "SET_WORKFORCE_COUNTS") {
        if (payload) setCounts(payload);
      } else if (command === "SET_WORKFORCE_QUEUE") {
        if (payload) setQueue(payload);
      } else if (command === "SET_WORKFORCE_APPROVALS") {
        setApprovals(payload || []);
      } else if (command === "SET_WORKFORCE_PROPOSALS") {
        setProposals(payload || []);
      } else if (command === "PROPOSAL_UPDATED") {
        const proposal: ProposalDto | undefined = payload?.proposal;
        if (proposal) {
          setProposals(prev => [proposal, ...(prev || []).filter(p => p.id !== proposal.id)]);
        }
      } else if (command === "APPROVAL_UPDATED") {
        const approval: ApprovalDto | undefined = payload?.approval;
        if (approval) {
          setApprovals(prev => [approval, ...(prev || []).filter(a => a.id !== approval.id)]);
        }
      } else if (command === "SET_WORKFORCE_SCHEDULES") {
        setSchedules(payload || []);
      } else if (command === "SET_WORKFORCE_ACTIVITY") {
        setActivity(payload || []);
      } else if (command === "SET_WORKFORCE_EVENT_RULES") {
        setEventRules(payload || []);
      } else if (command === "SET_WORKFORCE_EXEC_WINDOWS") {
        setExecWindows(payload || []);
      } else if (command === "SET_WORKFORCE_WORKFLOWS") {
        setWorkflows(payload || []);
      } else if (command === "RUN_UPDATED") {
        const run: RunDto | undefined = payload?.run;
        if (run) {
          setRuns(prev => {
            const next = [run, ...(prev || []).filter(r => r.id !== run.id)];
            return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          });
          if (run.status === "running") setBusy("running");
          if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") setBusy("done");
        }
      } else if (command === "WORKFORCE_RESPONSE") {
        if (messageError) {
          setError(messageError);
          setConfigResult(messageError);
          setRuleError(messageError);
          setValidateError(messageError);
          setWindowError(messageError);
          setRunActionError(messageError);
          setFindingActionError(messageError);
          setApprovalActionError(messageError);
          setTaskActionError(messageError);
          setProposalActionError(messageError);
          setBusy("error");
        } else if (payload) {
          setOutcome(payload);
          setBusy(payload?.ran ? "done" : "idle");
          setError("");
          if (payload?.rule) setRuleResult("Rule created.");
          if (payload?.deleted !== undefined) setRuleResult(payload?.deleted ? "Rule deleted." : "");
          if (payload?.queueProcessed) setQueueResult(`Queue pass: ${payload.claimed} claimed, ${payload.started} started, ${payload.skipped} skipped.`);
          if (payload?.scanned !== undefined) {
            setClassifyResult(
              `Classification pass: ${payload.proposed} proposed, ${payload.applied} applied, ` +
              `${payload.requestedApproval} approval-requested, ${payload.failed} failed, ${payload.duplicates} duplicates (${payload.scanned} scanned).`
            );
          }
          if (payload?.retried) setQueueResult(`Run ${payload.run?.id} queued for retry.`);
          if (payload?.cancelled) {
            const name = payload?.run?.taskTitle || payload?.runId;
            setRunAction(name ? `Run ${name} cancelled.` : "Run cancelled.");
          }
          if (payload?.window) {
            if (payload?.started) setWindowResult(`Execution window "${payload.window.name}" started.`);
            else if (payload?.cancelled) setWindowResult(`Execution window "${payload.window.name}" cancelled.`);
            else setWindowResult(`Execution window "${payload.window.name}" created.`);
          }
          if (payload?.decided) setFindingAction(`Finding ${payload.decision === "approved" ? "approved" : "rejected"}.`);
          if (payload?.validated) setFindingAction("Agent validation recorded.");
          if (payload?.resolved) setApprovalAction(`Approval ${payload.decision === "approved" ? "approved" : "rejected"}.`);
          if (payload?.updated) {
            setTaskAction("Task updated.");
            setEditingTask(null);
            setConfirmDeleteTask(null);
          }
          if (payload?.applied) {
            setProposalAction(payload?.proposal?.title ? `Proposal "${payload.proposal.title}" applied — task created.` : "Proposal applied.");
          }
          if (payload?.rejected) {
            setProposalAction(payload?.proposal?.title ? `Proposal "${payload.proposal.title}" rejected.` : "Proposal rejected.");
          }
          if (payload?.edited) {
            setProposalAction(payload?.proposal?.title ? `Proposal "${payload.proposal.title}" updated.` : "Proposal updated.");
            setEditingProposal(null);
          }
          if (payload?.requeued) {
            setProposalAction(payload?.proposal?.title ? `Proposal "${payload.proposal.title}" requeued to pending.` : "Proposal requeued to pending.");
          }
          if (payload?.deleted) {
            setTaskAction("Task deleted.");
            setEditingTask(null);
            setConfirmDeleteTask(null);
          }
        }
      }
    };
    window.addEventListener("message", handler);
    postRequest("WORKFORCE_INIT");
    return () => window.removeEventListener("message", handler);
  }, []);

  const setFormField = (field: keyof typeof form, value: string): void => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const createAndRun = (): void => {
    if (!form.title.trim()) {setError("Enter a task title"); return;}
    setError("");
    setBusy("running");
    setOutcome(null);
    postRequest("WORKFORCE_CREATE_TASK", {
      title: form.title,
      type: form.type,
      priority: form.priority,
      backlog: form.backlog || undefined,
      agentId: form.agentId || undefined,
      runMode: form.runMode
    });
  };

  const cancelRun = (runId: string): void => {
    postRequest("WORKFORCE_CANCEL_RUN", { runId });
  };

  const retryRun = (runId: string): void => {
    setQueueResult("");
    postRequest("WORKFORCE_RETRY_RUN", { runId });
  };

  const processQueueNow = (): void => {
    setQueueResult("");
    postRequest("WORKFORCE_PROCESS_QUEUE");
  };

  const classifyNow = (): void => {
    setClassifyResult("");
    postRequest("WORKFORCE_RUN_CLASSIFICATION", {});
  };

  const applyProposal = (proposalId: string): void => {
    setProposalAction("");
    postRequest("WORKFORCE_APPLY_PROPOSAL", { proposalId });
  };

  const rejectProposal = (proposalId: string): void => {
    setProposalAction("");
    postRequest("WORKFORCE_REJECT_PROPOSAL", { proposalId });
  };

  const requeueProposal = (proposalId: string): void => {
    setProposalAction("");
    setProposalActionError("");
    postRequest("WORKFORCE_REQUEUE_PROPOSAL", { proposalId });
  };

  const startEditProposal = (p: ProposalDto): void => {
    setProposalAction("");
    setProposalActionError("");
    setEditingProposal(p);
    setProposalEditForm({ title: p.title, type: p.type, priority: p.priority, workflow: p.workflow || "" });
  };

  const cancelEditProposal = (): void => {
    setProposalActionError("");
    setEditingProposal(null);
  };

  const saveEditProposal = (p: ProposalDto): void => {
    if (!proposalEditForm.title.trim()) {
      setProposalActionError("Title must be non-empty.");
      return;
    }
    setProposalActionError("");
    postRequest("WORKFORCE_EDIT_PROPOSAL", {
      proposalId: p.id,
      changes: {
        title: proposalEditForm.title,
        type: proposalEditForm.type,
        priority: proposalEditForm.priority,
        workflow: proposalEditForm.workflow
      }
    });
  };

  const gotoRuns = (filter: RunFilter): void => {
    setRunFilter(filter);
    setTab("runs");
  };

  const gotoFindings = (filter: FindingFilter): void => {
    setFindingFilter(filter);
    setTab("findings");
  };

  const openRun = (runId: string): void => {
    setRunFocus(runId);
    setTab("runs");
  };

  const openFinding = (findingId: string): void => {
    setFindingFocus(findingId);
    setTab("findings");
  };

  const openWindow = (windowId: string): void => {
    setWindowFocus(windowId);
    setTab("windows");
  };

  const openWorkflow = (workflowId: string): void => {
    setWorkflowFocus(workflowId);
    setTab("workflows");
  };

  const openRule = (ruleId: string): void => {
    setRuleFocus(ruleId);
    setTab("event-rules");
  };

  const openTask = (taskId: string): void => {
    setTaskFocus(taskId);
    setTab("tasks");
  };

  const openEmployee = (employeeId: string): void => {
    setEmployeeFocus(employeeId);
    setTab("employees");
  };

  const decideFinding = (findingId: string, decision: "approved" | "rejected"): void => {
    postRequest("WORKFORCE_DECIDE_FINDING", { findingId, decision });
  };

  const resolveApproval = (approvalId: string, decision: "approved" | "rejected"): void => {
    setApprovalAction("");
    setApprovalActionError("");
    postRequest("WORKFORCE_RESOLVE_APPROVAL", { approvalId, decision });
  };

  const startEditTask = (t: TaskDto): void => {
    setTaskAction("");
    setTaskActionError("");
    setEditingTask(t);
    setTaskEditForm({
      title: t.title,
      status: t.status,
      priority: t.priority || "medium",
      agent: t.agent || ""
    });
  };

  const saveTaskEdit = (taskId: string): void => {
    setTaskAction("");
    setTaskActionError("");
    if (!taskEditForm.title.trim()) { setTaskActionError("Task title is required"); return; }
    postRequest("WORKFORCE_UPDATE_TASK", {
      taskId,
      updates: {
        title: taskEditForm.title.trim(),
        status: taskEditForm.status,
        priority: taskEditForm.priority,
        agent: taskEditForm.agent || undefined
      }
    });
  };

  const requestDeleteTask = (taskId: string): void => {
    setConfirmDeleteTask(prev => prev === taskId ? null : taskId);
  };

  const confirmDeleteTaskAction = (taskId: string): void => {
    setTaskAction("");
    setTaskActionError("");
    postRequest("WORKFORCE_DELETE_TASK", { taskId });
  };

  const openValidate = (f: FindingDto): void => {
    setValidateFor(f);
    setValidateError("");
    setValidateForm(prev => ({ ...prev, validatorId: prev.validatorId || (validators.length > 0 ? validators[0].id : "") }));
  };

  const closeValidate = (): void => {
    setValidateFor(null);
    setValidateError("");
  };

  const setValidateField = (field: keyof typeof validateForm, value: string): void => {
    setValidateForm(prev => ({ ...prev, [field]: value }));
  };

  const submitValidate = (): void => {
    if (!validateFor) return;
    if (!validateForm.validatorId) {setValidateError("Select a validating agent"); return;}
    setValidateError("");
    postRequest("WORKFORCE_VALIDATE_FINDING", {
      findingId: validateFor.id,
      validatorId: validateForm.validatorId,
      recommendation: validateForm.recommendation,
      confidence: validateForm.confidence !== "" ? Number(validateForm.confidence) : undefined,
      reason: validateForm.reason.trim() || undefined
    });
  };

  const setRuleFormField = (field: keyof typeof ruleForm, value: string): void => {
    setRuleForm(prev => ({ ...prev, [field]: value }));
  };

  const createEventRule = (): void => {
    if (!ruleForm.name.trim()) {setRuleError("Enter a rule name"); return;}
    if (!ruleForm.workflowId) {setRuleError("Select a workflow to trigger"); return;}
    setRuleError("");
    setRuleResult("");
    postRequest("WORKFORCE_CREATE_EVENT_RULE", {
      name: ruleForm.name.trim(),
      description: ruleForm.description.trim() || undefined,
      matcher: {
        eventType: ruleForm.eventType.trim() || undefined,
        source: ruleForm.source.trim() || undefined,
        payloadKey: ruleForm.payloadKey.trim() || undefined,
        payloadValue: ruleForm.payloadValue.trim() || undefined
      },
      workflowId: ruleForm.workflowId
    });
    setRuleForm({ name: "", description: "", eventType: "", source: "", payloadKey: "", payloadValue: "", workflowId: "" });
  };

  const toggleEventRule = (ruleId: string, enabled: boolean): void => {
    setRuleError("");
    postRequest("WORKFORCE_SET_EVENT_RULE_ENABLED", { ruleId, enabled });
  };

  const deleteEventRule = (ruleId: string): void => {
    setRuleError("");
    postRequest("WORKFORCE_DELETE_EVENT_RULE", { ruleId });
  };

  const setWindowField = (field: "name" | "goal" | "workerMode", value: string): void => {
    setWindowForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleWindowWorkflow = (workflowId: string): void => {
    setWindowForm(prev => ({
      ...prev,
      workflowIds: prev.workflowIds.includes(workflowId)
        ? prev.workflowIds.filter(id => id !== workflowId)
        : [...prev.workflowIds, workflowId]
    }));
  };

  const toggleWindowAgent = (agentId: string): void => {
    setWindowForm(prev => ({
      ...prev,
      agentIds: prev.agentIds.includes(agentId)
        ? prev.agentIds.filter(id => id !== agentId)
        : [...prev.agentIds, agentId]
    }));
  };

  const createExecutionWindow = (): void => {
    if (!windowForm.name.trim()) {setWindowError("Enter a window name"); return;}
    if (windowForm.workflowIds.length === 0) {setWindowError("Select at least one workflow"); return;}
    setWindowError("");
    setWindowResult("");
    postRequest("WORKFORCE_CREATE_EXEC_WINDOW", {
      name: windowForm.name.trim(),
      goal: windowForm.goal.trim() || undefined,
      workflowIds: windowForm.workflowIds,
      agentIds: windowForm.agentIds,
      workerMode: windowForm.workerMode || undefined
    });
    setWindowForm({ name: "", goal: "", workflowIds: [], agentIds: [], workerMode: "" });
  };

  const startExecutionWindow = (windowId: string): void => {
    setWindowError("");
    setWindowResult("");
    postRequest("WORKFORCE_START_EXEC_WINDOW", { windowId });
  };

  const cancelExecutionWindow = (windowId: string): void => {
    setWindowError("");
    setWindowResult("");
    postRequest("WORKFORCE_CANCEL_EXEC_WINDOW", { windowId });
  };

  const ruleMatcherText = (matcher: EventRuleMatcherDto): string => {
    const parts: string[] = [];
    if (matcher.eventType) parts.push(`type: ${matcher.eventType}`);
    if (matcher.source) parts.push(`source: ${matcher.source}`);
    if (matcher.payloadKey) {
      parts.push(`payload.${matcher.payloadKey}${matcher.payloadValue ? ` = ${matcher.payloadValue}` : " present"}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "any event";
  };

  const startCreateForAgent = (agentId: string): void => {
    setForm(prev => ({ ...prev, agentId }));
    setTab("create-task");
  };

  const openConfigure = (e: EmployeeDto): void => {
    setEditingAgent(e);
    setConfigForm({
      provider: e.modelProfile?.provider || "",
      model: e.modelProfile?.model || "",
      baseUrl: e.modelProfile?.baseUrl || "",
      tool: e.agentConfig?.tool || "",
      command: e.agentConfig?.command || "",
      capabilities: (e.capabilities || []).join(", ")
    });
    setConfigResult("");
  };

  const closeConfigure = (): void => {
    setEditingAgent(null);
    setConfigResult("");
  };

  const setConfigField = (field: keyof typeof configForm, value: string): void => {
    setConfigForm(prev => ({ ...prev, [field]: value }));
  };

  const saveConfigure = (): void => {
    if (!editingAgent) {return;}
    setConfigResult("");
    const change: {
      modelProfile?: { provider: string; model: string; baseUrl?: string };
      agentConfig?: { tool: string; command?: string };
      capabilities: string[];
    } = { capabilities: configForm.capabilities.split(",").map(c => c.trim()).filter(Boolean) };

    const provider = configForm.provider;
    const model = configForm.model.trim();
    if (provider && model) {
      change.modelProfile = { provider, model, ...(configForm.baseUrl.trim() ? { baseUrl: configForm.baseUrl.trim() } : {}) };
    }
    const tool = configForm.tool.trim();
    if (tool) {
      change.agentConfig = { tool, ...(configForm.command.trim() ? { command: configForm.command.trim() } : {}) };
    }

    postRequest("WORKFORCE_UPDATE_AGENT", { employeeId: editingAgent.id, change });
  };

  const agents = employees.filter(e => e.role === "agent");
  const validators = employees.filter(e => e.permissions.includes("finding:validate"));
  const runningCount = overview.runs.running;

  const filteredRuns = runs.filter(r => {
    switch (runFilter) {
      case "queued": return r.status === "queued" && !isRetrying(r);
      case "running": return r.status === "running";
      case "retrying": return isRetrying(r);
      case "completed": return r.status === "completed";
      case "failed": return r.status === "failed";
      case "cancelled": return r.status === "cancelled";
      default: return true;
    }
  });

  const filteredFindings = findings.filter(f => {
    switch (findingFilter) {
      case "agent": return f.status === "pending" && !f.agentReview;
      case "human": return f.status === "pending" && !!f.agentReview;
      case "approved": return f.status === "approved";
      case "rejected": return f.status === "rejected";
      default: return true;
    }
  });

  const StatChip = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button style={styles.statButton} onClick={onClick}>{label}</button>
  );

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Workforce Control Center</h1>
        <span style={styles.subtitle}>
          {overview.employees.agents} agents · {runningCount} running · {overview.runs.queued} queued
        </span>
      </div>

      {!loaded && <div style={styles.loading}>Loading workforce state…</div>}

      <div style={styles.statRow}>
        <StatChip label={`Workers ${queue.busyEmployees}/${queue.maxConcurrentRuns}`} onClick={() => setTab("employees")} />
        <StatChip label={`Running ${overview.runs.running}`} onClick={() => gotoRuns("running")} />
        <StatChip label={`Queued ${overview.runs.queued}`} onClick={() => gotoRuns("queued")} />
        <StatChip label={`Retrying ${queue.waitingRetry}`} onClick={() => gotoRuns("retrying")} />
        <StatChip label={`Completed ${overview.runs.completed}`} onClick={() => gotoRuns("completed")} />
        <StatChip label={`Failed ${overview.runs.failed}`} onClick={() => gotoRuns("failed")} />
        <StatChip label={`Findings ${counts.pendingFindings}`} onClick={() => gotoFindings("all")} />
        <StatChip label={`Agent Reviews ${counts.pendingAgentReview}`} onClick={() => gotoFindings("agent")} />
        <StatChip label={`Human Reviews ${counts.pendingHumanReview}`} onClick={() => gotoFindings("human")} />
        <StatChip label={`Approvals ${counts.pendingApprovals}`} onClick={() => setTab("approvals")} />
        <StatChip label={`Proposals ${counts.proposals}`} onClick={() => setTab("proposals")} />
        <StatChip label={`Schedules ${counts.schedules}`} onClick={() => setTab("schedules")} />
        <StatChip label={`Workflows ${counts.workflows}`} onClick={() => setTab("workflows")} />
        <StatChip label={`Event Rules ${counts.eventRules}`} onClick={() => setTab("event-rules")} />
        <StatChip label={`Windows ${counts.exeWindows}`} onClick={() => setTab("windows")} />
      </div>

      {activity.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {activity.slice(0, 4).map(ev => (
            <div key={ev.id} style={styles.ticker}>
              <span style={{ color: "#e0e0e0", marginRight: 6 }}>{ev.label}</span>
              <span style={styles.muted}>{formatTime(ev.timestamp)}</span>
              {ev.links.runId && <button style={styles.link} onClick={() => openRun(ev.links.runId!)}>run</button>}
              {ev.links.findingId && <button style={styles.link} onClick={() => openFinding(ev.links.findingId!)}>finding</button>}
              {ev.links.windowId && <button style={styles.link} onClick={() => openWindow(ev.links.windowId!)}>window</button>}
              <button style={{ ...styles.link, marginLeft: "auto" }} onClick={() => setTab("activity")}>more…</button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "employees" && (
        <div>
          {editingAgent && (
            <div style={{ ...styles.card, marginBottom: 12 }}>
              <div style={styles.row}>
                <span style={styles.name}>Configure {editingAgent.name}</span>
                <span style={{ flex: 1 }} />
                <button style={styles.buttonGhost} onClick={closeConfigure}>Close</button>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Model provider</label>
                  <select style={styles.select} value={configForm.provider} onChange={ev => setConfigField("provider", ev.target.value)}>
                    <option value="">— none —</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Model</label>
                  <input style={styles.input} value={configForm.model} placeholder="e.g. gemma4:31b-cloud" onChange={ev => setConfigField("model", ev.target.value)} />
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Base URL (optional)</label>
                <input style={styles.input} value={configForm.baseUrl} placeholder="http://localhost:11434" onChange={ev => setConfigField("baseUrl", ev.target.value)} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Agent tool (agentConfig.tool)</label>
                  <select style={styles.select} value={configForm.tool} onChange={ev => setConfigField("tool", ev.target.value)}>
                    <option value="">— none —</option>
                    {(["opencode", "ollama", "claude-code", "custom"] as const).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Command (optional)</label>
                  <input style={styles.input} value={configForm.command} onChange={ev => setConfigField("command", ev.target.value)} />
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Capabilities (comma-separated)</label>
                <input style={styles.input} value={configForm.capabilities} onChange={ev => setConfigField("capabilities", ev.target.value)} />
              </div>

              {editingAgent.permissions.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span style={styles.muted}>Permissions: </span>
                  {editingAgent.permissions.map(p => <span key={p} style={{ ...styles.chip, marginRight: 4 }}>{p}</span>)}
                </div>
              )}

              {configResult && (
                <div style={configResult.toLowerCase().includes("error") || configResult.toLowerCase().includes("lacks") || configResult.toLowerCase().includes("not found") || configResult.toLowerCase().includes("required") ? styles.error : styles.ok}>
                  {configResult}
                </div>
              )}

              <button style={styles.button} onClick={saveConfigure}>Save</button>
            </div>
          )}
          {agents.length === 0 && <div style={styles.empty}>No agents yet. Add an agent employee to get started.</div>}
          {agents.map(e => (
            <div key={e.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{e.name}</span>
                <span style={styles.statusChip}>{e.status || "idle"}</span>
                {e.modelProfile?.model && <span style={styles.chip}>{e.modelProfile.provider} · {e.modelProfile.model}</span>}
                {e.agentConfig?.tool && <span style={styles.chip}>tool: {e.agentConfig.tool}</span>}
                <span style={{ flex: 1 }} />
                <button style={styles.buttonGhost} onClick={() => openConfigure(e)}>Configure</button>
                <button style={styles.button} onClick={() => startCreateForAgent(e.id)}>Create Task</button>
              </div>
              {e.capabilities.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {e.capabilities.map(c => <span key={c} style={{ ...styles.chip, marginRight: 4 }}>{c}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "create-task" && (
        <div style={{ maxWidth: 520 }}>
          <div style={styles.field}>
            <label style={styles.label}>Task title</label>
            <input
              style={styles.input}
              value={form.title}
              placeholder="e.g. Research Moroccan election news"
              onChange={ev => setFormField("title", ev.target.value)}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Agent</label>
            <select style={styles.select} value={form.agentId} onChange={ev => setFormField("agentId", ev.target.value)}>
              <option value="">— Select agent —</option>
              {agents.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Type</label>
              <select style={styles.select} value={form.type} onChange={ev => setFormField("type", ev.target.value)}>
                {TYPE_CHOICES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Priority</label>
              <select style={styles.select} value={form.priority} onChange={ev => setFormField("priority", ev.target.value)}>
                {PRIORITY_CHOICES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Backlog (optional)</label>
            <input
              style={styles.input}
              value={form.backlog}
              placeholder="features"
              onChange={ev => setFormField("backlog", ev.target.value)}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Run mode</label>
            {MODES.map(m => (
              <label key={m.value} style={{ display: "block", fontSize: 13, marginBottom: 4, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="runMode"
                  style={{ marginRight: 6 }}
                  checked={form.runMode === m.value}
                  onChange={() => setFormField("runMode", m.value)}
                />
                <b>{m.label}</b>
                {" — "}
                <span style={styles.muted}>{m.hint}</span>
              </label>
            ))}
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {busy === "done" && outcome && (
            <div style={styles.ok}>
              Run {outcome.runId} queued. {outcome.ran ? (outcome.result?.status || "finished") : (outcome.approvalRequired ? "Approval required — run stays queued." : "Queued — waiting on the queue.")}{" "}
              See the Runs tab for details.
            </div>
          )}

          <button
            style={{ ...styles.button, fontSize: 14, padding: "8px 18px", opacity: busy === "running" ? 0.6 : 1 }}
            disabled={busy === "running"}
            onClick={createAndRun}
          >
            {busy === "running" ? "Running…" : "Create & Run"}
          </button>
        </div>
      )}

      {tab === "runs" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ ...styles.filterRow, margin: 0, flex: 1 }}>
              {RUN_FILTER_OPTIONS.map(o => (
                <button
                  key={o.key}
                  style={runFilter === o.key ? styles.filterChipActive : styles.filterChip}
                  onClick={() => setRunFilter(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button style={styles.button} onClick={processQueueNow}>Process Queue</button>
            <button style={styles.button} onClick={classifyNow}>Classify Findings</button>
          </div>
          {queueResult && <div style={styles.ok}>{queueResult}</div>}
          {classifyResult && <div style={styles.ok}>{classifyResult}</div>}
          {proposals.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <span style={styles.muted}>
                {proposals.length} classification proposals (newest first)
              </span>
            </div>
          )}
          {runActionError && <div style={styles.error}>{runActionError}</div>}
          {runAction && <div style={styles.ok}>{runAction}</div>}
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <span style={styles.muted}>
              Worker: {queue.workerMode} (queue mode) · Occupancy {queue.allocated}/{queue.maxConcurrentRuns} · Attempts &gt;1: {queue.multiAttempt}
            </span>
          </div>
          {filteredRuns.length === 0 && <div style={styles.empty}>No {runFilter === "all" ? "runs" : `${runFilter} runs`} yet.</div>}
          {filteredRuns.map(run => {
            const runFindings = findings.filter(f => f.runId === run.id);
            const expanded = expandedRun === run.id || runFocus === run.id;
            return (
              <div key={run.id} style={runFocus === run.id ? styles.cardFocused : styles.card}>
                <div style={styles.row}>
                  <span style={styles.name}>{run.taskTitle}</span>
                  <span style={styles.muted}>{run.taskCode}</span>
                  <span style={{ ...styles.statusChip, color: statusColor(run.status) }}>
                    {isRetrying(run) ? "retrying" : run.status}
                  </span>
                  <span style={styles.muted}>Agent: {run.agentName}</span>
                  {run.attempts > 1 && <span style={styles.chip}>attempt {run.attempts}</span>}
                  {run.windowName && (
                    <button style={styles.link} onClick={() => openWindow(run.windowId!)}>window: {run.windowName}</button>
                  )}
                  <span style={{ flex: 1 }} />
                  {run.startedAt && <span style={styles.muted}>Started {formatTime(run.startedAt)}</span>}
                  {run.durationMs !== undefined && <span style={styles.muted}>{formatDuration(run.durationMs)}</span>}
                  {(run.status === "queued" || run.status === "running") && (
                    <button style={styles.buttonGhost} onClick={() => cancelRun(run.id)}>Cancel</button>
                  )}
                  {(run.status === "failed" || run.status === "cancelled") && run.agentId && (
                    <button style={styles.buttonGhost} onClick={() => retryRun(run.id)}>Retry</button>
                  )}
                  {run.status === "completed" && run.agentId && (
                    <button style={styles.buttonGhost} onClick={() => retryRun(run.id)}>Run Again</button>
                  )}
                  <button style={styles.buttonGhost} onClick={() => setExpandedRun(expanded ? null : run.id)}>
                    {expanded ? "Hide" : "Details"}
                  </button>
                </div>
                {run.status === "completed" && run.summary && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <span style={styles.ok}>Findings: {run.summary.findings}</span>{" "}
                    <span style={run.summary.errors > 0 ? styles.error : styles.muted}>Errors: {run.summary.errors}</span>
                    {run.summary.findings > 0 && (
                      <span style={styles.muted}> · {runFindings.length} linked</span>
                    )}
                  </div>
                )}
                {run.status === "failed" && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <span style={styles.error}>Failed</span>
                    {run.error && <span style={styles.muted}> · {run.error}</span>}
                  </div>
                )}
                {expanded && (
                  <div>
                    <div style={styles.detail}>
                      <div>
                        <span style={styles.muted}>Task: </span><button style={styles.link} onClick={() => openTask(run.taskId)}>{run.taskCode} — {run.taskTitle}</button>
                      </div>
                      {run.taskWorkflow && (
                        <div>
                          <span style={styles.muted}>Workflow: </span><button style={styles.link} onClick={() => openWorkflow(run.taskWorkflow!)}>{run.taskWorkflow}</button>
                        </div>
                      )}
                      {run.trigger && (
                        <div>
                          <span style={styles.muted}>Trigger: </span>
                          <button style={styles.link} onClick={() => openRule(run.trigger!.ruleId)}>Event Rule "{run.trigger.ruleName}"</button>
                          <span style={styles.muted}> ({run.trigger.eventType})</span>
                        </div>
                      )}
                      <div>
                        <span style={styles.muted}>Agent: </span>
                        {run.agentId ? <button style={styles.link} onClick={() => openEmployee(run.agentId!)}>{run.agentName} ({run.agentId})</button> : <span>{run.agentName}</span>}
                      </div>
                      <div>
                        <span style={styles.muted}>Worker (queue): </span>{run.mode || "—"}
                        <span style={styles.muted}> · Model: </span>{run.model || "—"}
                      </div>
                      <div><span style={styles.muted}>Attempt: </span>{run.attempts}</div>
                      <div>
                        <span style={styles.muted}>Created </span>{formatTime(run.createdAt)}
                        {run.startedAt && <span><span style={styles.muted}> · Started </span>{formatTime(run.startedAt)}</span>}
                        {run.finishedAt && <span><span style={styles.muted}> · Finished </span>{formatTime(run.finishedAt)}</span>}
                        <span style={styles.muted}> · Duration </span>{formatDuration(run.durationMs)}
                      </div>
                    </div>
                    {runFindings.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 12 }}>
                        <span style={styles.muted}>Findings ({runFindings.length}): </span>
                        {runFindings.map(f => (
                          <button key={f.id} style={styles.link} onClick={() => openFinding(f.id)} title={f.title}>
                            {f.title} · {reviewStateLabel(f)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={styles.output}>
                      {run.result && <div><b>Output</b>{"\n"}{run.result}</div>}
                      {run.error && <div>{run.result ? "\n\n" : ""}<b>Error</b>{"\n"}{run.error}</div>}
                      {!run.result && !run.error && <div>No output captured.</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "findings" && (
        <div>
          <div style={styles.filterRow}>
            {FINDING_FILTER_OPTIONS.map(o => (
              <button
                key={o.key}
                style={findingFilter === o.key ? styles.filterChipActive : styles.filterChip}
                onClick={() => setFindingFilter(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {findingActionError && <div style={styles.error}>{findingActionError}</div>}
          {findingAction && <div style={styles.ok}>{findingAction}</div>}
          {filteredFindings.length === 0 && (
            <div style={styles.empty}>No findings yet. Findings are captured from the Findings section of completed run output.</div>
          )}
          {filteredFindings.map(f => (
            <div key={f.id} style={findingFocus === f.id ? styles.cardFocused : styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{f.title}</span>
                <span style={{ ...styles.chip, color: severityColor(f.severity) }}>{f.severity}</span>
                {f.confidence !== undefined && <span style={styles.chip}>{Math.round(f.confidence * 100)}%</span>}
                {f.agentReview ? (
                  <span style={{ ...styles.chip, color: recommendationColor(f.agentReview.recommendation) }}>
                    {recommendationLabel(f.agentReview.recommendation)}
                  </span>
                ) : (
                  <span style={styles.chip}>agent review</span>
                )}
                <span style={{ ...styles.statusChip, color: f.status === "approved" ? "#4caf50" : f.status === "rejected" ? "#e53935" : "#ffb74d" }}>
                  {f.status === "pending"
                    ? f.agentReview
                      ? "pending human review"
                      : "pending agent review"
                    : f.status}
                </span>
                <span style={{ flex: 1 }} />
                {f.status === "pending" && !f.agentReview && (
                  <button style={styles.button} onClick={() => openValidate(f)}>Validate</button>
                )}
                {f.status === "pending" && (
                  <>
                    <button style={styles.button} onClick={() => decideFinding(f.id, "approved")}>Approve</button>
                    <button style={styles.buttonGhost} onClick={() => decideFinding(f.id, "rejected")}>Reject</button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {f.runId && <button style={styles.link} onClick={() => openRun(f.runId)}>run</button>}
                <span style={styles.muted}>Agent: {f.agentName}</span>
                {f.category && <span style={styles.muted}> · {f.category}</span>}
                {f.taskTitle && <span style={styles.muted}> · Task: {f.taskTitle}</span>}
                <span style={styles.muted}> · {formatTime(f.timestamp)}</span>
              </div>

              {validateFor?.id === f.id && (
                <div style={{ ...styles.card, marginTop: 10, padding: 10, background: "#101418" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ ...styles.field, flex: 1 }}>
                      <label style={styles.label}>Validating agent</label>
                      <select style={styles.select} value={validateForm.validatorId} onChange={ev => setValidateField("validatorId", ev.target.value)}>
                        {validators.length === 0 && <option value="">— no agent holds finding:validate —</option>}
                        {validators.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div style={{ ...styles.field, flex: 1 }}>
                      <label style={styles.label}>Recommendation</label>
                      <select style={styles.select} value={validateForm.recommendation} onChange={ev => setValidateField("recommendation", ev.target.value)}>
                        <option value="recommend-approve">Recommend approve</option>
                        <option value="recommend-reject">Recommend reject</option>
                        <option value="request-revision">Request revision</option>
                      </select>
                    </div>
                    <div style={{ ...styles.field, flex: 1 }}>
                      <label style={styles.label}>Confidence (0–1)</label>
                      <input style={styles.input} value={validateForm.confidence} placeholder="0.9" onChange={ev => setValidateField("confidence", ev.target.value)} />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Reason (optional)</label>
                    <input style={styles.input} value={validateForm.reason} onChange={ev => setValidateField("reason", ev.target.value)} />
                  </div>
                  {validateError && <div style={styles.error}>{validateError}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={styles.button} onClick={submitValidate}>Record Validation</button>
                    <button style={styles.buttonGhost} onClick={closeValidate}>Cancel</button>
                  </div>
                </div>
              )}

              {f.agentReview && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  <span style={styles.muted}>
                    Validated by{" "}
                  </span>
                  <button style={styles.link} onClick={() => openEmployee(f.agentReview!.validatorId)}>{f.agentReview.validatorName || f.agentReview.validatorId}</button>
                  <span style={styles.muted}>
                    {f.agentReview.confidence !== undefined && ` · ${Math.round(f.agentReview.confidence * 100)}% confidence`}
                    {f.agentReview.reason && ` · ${f.agentReview.reason}`}
                    {` · ${formatTime(f.agentReview.validatedAt)}`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "proposals" && (
        <div>
          {proposals.length === 0 && (
            <div style={styles.empty}>No classification proposals yet. Run a classification pass from the Runs tab or review findings with suggested fields — each proposal is reviewed here before it becomes a task.</div>
          )}
          {proposalActionError && <div style={styles.error}>{proposalActionError}</div>}
          {proposalAction && <div style={styles.ok}>{proposalAction}</div>}
          {proposals.map(p => (
            <div key={p.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{p.title}</span>
                <span style={{ ...styles.statusChip, color: p.status === "pending" ? "#ffb74d" : p.status === "applied" ? "#4caf50" : p.status === "failed" ? "#e53935" : "#9e9e9e" }}>{p.status}</span>
                <span style={styles.chip}>{p.type}</span>
                <span style={styles.chip}>{p.priority}</span>
                {p.workflow && <span style={styles.chip}>{p.workflow}</span>}
                {p.confidence !== undefined && <span style={styles.chip}>{Math.round(p.confidence * 100)}% conf</span>}
                {!!p.editCount && <span style={styles.chip}>edited {p.editCount}x</span>}
                <span style={{ flex: 1 }} />
                <span style={styles.muted}>{formatTime(p.createdAt)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={styles.muted}>finding {p.findingId.slice(0, 8)}</span>
                {p.status !== "pending" && p.reason && <span style={styles.muted}> · {p.reason}</span>}
                {p.appliedTaskId && <span style={styles.muted}> · task {p.appliedTaskId}</span>}
              </div>
              {p.status === "pending" && (
                <div style={{ marginTop: 8 }}>
                  <button style={styles.button} onClick={() => applyProposal(p.id)}>Apply as Task</button>
                  <button style={styles.buttonGhost} onClick={() => rejectProposal(p.id)}>Reject</button>
                  {editingProposal?.id !== p.id && (
                    <button style={styles.buttonGhost} onClick={() => startEditProposal(p)}>Edit</button>
                  )}
                </div>
              )}
              {p.status === "rejected" && (
                <div style={{ marginTop: 8 }}>
                  <button style={styles.buttonGhost} onClick={() => requeueProposal(p.id)}>Requeue</button>
                </div>
              )}
              {editingProposal?.id === p.id && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>
                  <input
                    style={styles.input}
                    value={proposalEditForm.title}
                    onChange={e => setProposalEditForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Title"
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      style={styles.input}
                      value={proposalEditForm.type}
                      onChange={e => setProposalEditForm(f => ({ ...f, type: e.target.value }))}
                    >
                      {["feature", "bug", "chore", "doc", "test"].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <select
                      style={styles.input}
                      value={proposalEditForm.priority}
                      onChange={e => setProposalEditForm(f => ({ ...f, priority: e.target.value }))}
                    >
                      {["high", "medium", "low"].map(pr => (
                        <option key={pr} value={pr}>{pr}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    style={styles.input}
                    value={proposalEditForm.workflow}
                    onChange={e => setProposalEditForm(f => ({ ...f, workflow: e.target.value }))}
                    placeholder="Workflow"
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={styles.button} onClick={() => saveEditProposal(p)}>Save Edit</button>
                    <button style={styles.buttonGhost} onClick={() => cancelEditProposal()}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "approvals" && (
        <div>
          {approvals.filter(a => a.status === "pending").length === 0 && (
            <div style={styles.empty}>No pending approvals. Approval gates only come into play when a gate is set to manual — everything else applies automatically.</div>
          )}
          {approvalActionError && <div style={styles.error}>{approvalActionError}</div>}
          {approvalAction && <div style={styles.ok}>{approvalAction}</div>}
          {approvals.map(a => (
            <div key={a.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{a.target}</span>
                <span style={{ ...styles.statusChip, color: a.status === "pending" ? "#ffb74d" : a.status === "approved" ? "#4caf50" : "#e53935" }}>{a.status}</span>
                <span style={styles.chip}>{a.type}</span>
                <span style={{ flex: 1 }} />
                <span style={styles.muted}>{formatTime(a.createdAt)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={styles.muted}>{a.reason}</span>
                {a.status !== "pending" && a.decisionBy && <span style={styles.muted}> · decided by {a.decisionBy} {formatTime(a.resolvedAt)}</span>}
              </div>
              {a.status === "pending" && (
                <div style={{ marginTop: 8 }}>
                  <button style={styles.button} onClick={() => resolveApproval(a.id, "approved")}>Approve</button>
                  <button style={styles.buttonGhost} onClick={() => resolveApproval(a.id, "rejected")}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "schedules" && (
        <div>
          {schedules.length === 0 && (
            <div style={styles.empty}>No schedules defined. A time-based schedule turns each due occurrence into a task + queued run. Define `.SprintDesk/workforce/schedules.yml` to get started.</div>
          )}
          {schedules.map(s => (
            <div key={s.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{s.name}</span>
                <span style={{ ...styles.statusChip, color: s.enabled ? "#4caf50" : "#9e9e9e" }}>{s.enabled ? "active" : "paused"}</span>
                <span style={styles.chip}>{s.kind}{s.cron ? ` · ${s.cron}` : s.intervalMs ? ` · every ${Math.round(s.intervalMs / 1000)}s` : ""}</span>
                <span style={styles.chip}>{s.action === "classify" ? "classify" : "task"}</span>
                <span style={styles.chip}>autonomy {s.autonomyLevel}</span>
                {s.runCount > 0 && <span style={styles.chip}>{s.runCount} run{s.runCount === 1 ? "" : "s"}</span>}
                <span style={{ flex: 1 }} />
                {s.lastRunAt && <span style={styles.muted}>last {formatTime(s.lastRunAt)}</span>}
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={styles.muted}>Autonomy 0 = off · 1 = observe/dry-run · 2+ = execute into the queue.</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "workflows" && (
        <div>
          {workflows.length === 0 && (
            <div style={styles.empty}>No workflows defined yet. A workflow declares the steps (tasks, tools, loops, conditions) a run executes — define one in `.SprintDesk/settings/workflows.yml` or via a future editor.</div>
          )}
          {workflows.map(wf => (
            <div key={wf.id} style={workflowFocus === wf.id ? styles.cardFocused : styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{wf.name}</span>
                <span style={{ ...styles.statusChip, color: wf.enabled ? "#4caf50" : "#9e9e9e" }}>{wf.enabled ? "enabled" : "disabled"}</span>
                <span style={styles.muted}>v{wf.version}</span>
                <span style={{ flex: 1 }} />
                <span style={styles.muted}>updated {formatTime(wf.updatedAt)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={styles.muted}>
                  Used by execution windows and event rules; an enabled workflow is immediately executable from a new window or rule.
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "event-rules" && (
        <div>
          <div style={styles.card}>
            <div style={styles.row}>
              <span style={styles.name}>New Event Rule</span>
              <span style={{ flex: 1 }} />
              <span style={styles.muted}>Emitted events matching the conditions trigger the workflow.</span>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Rule name</label>
                <input style={styles.input} value={ruleForm.name} placeholder="e.g. Triage merged PRs" onChange={ev => setRuleFormField("name", ev.target.value)} />
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Workflow to run</label>
                <select style={styles.select} value={ruleForm.workflowId} onChange={ev => setRuleFormField("workflowId", ev.target.value)}>
                  <option value="">— Select workflow —</option>
                  {workflows.map(wf => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
                </select>
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Description (optional)</label>
              <input style={styles.input} value={ruleForm.description} onChange={ev => setRuleFormField("description", ev.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Event type (optional)</label>
                <input style={styles.input} value={ruleForm.eventType} placeholder="e.g. pull_request.merged" onChange={ev => setRuleFormField("eventType", ev.target.value)} />
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Source (optional)</label>
                <input style={styles.input} value={ruleForm.source} placeholder="e.g. github" onChange={ev => setRuleFormField("source", ev.target.value)} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Payload key (optional)</label>
                <input style={styles.input} value={ruleForm.payloadKey} placeholder="e.g. taskId or repo.name" onChange={ev => setRuleFormField("payloadKey", ev.target.value)} />
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Payload value (optional)</label>
                <input style={styles.input} value={ruleForm.payloadValue} placeholder="e.g. morocco-news" onChange={ev => setRuleFormField("payloadValue", ev.target.value)} />
              </div>
            </div>

            {ruleError && <div style={styles.error}>{ruleError}</div>}
            {ruleResult && <div style={styles.ok}>{ruleResult}</div>}

            <button style={styles.button} onClick={createEventRule}>Create Rule</button>
          </div>

          {eventRules.length === 0 && (
            <div style={styles.empty}>No event rules yet. A rule turns matching events into workflow runs — the scheduler stays time-based, this is event-based.</div>
          )}
          {eventRules.map(rule => (
            <div key={rule.id} style={ruleFocus === rule.id ? styles.cardFocused : styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{rule.name}</span>
                <span style={{ ...styles.statusChip, color: rule.enabled ? "#4caf50" : "#9e9e9e" }}>
                  {rule.enabled ? "active" : "paused"}
                </span>
                {rule.workflowName && <button style={styles.link} onClick={() => openWorkflow(rule.workflowId)}>workflow: {rule.workflowName}</button>}
                {rule.runCount > 0 && <span style={styles.chip}>{rule.runCount} run{rule.runCount === 1 ? "" : "s"}</span>}
                <span style={{ flex: 1 }} />
                <button style={styles.buttonGhost} onClick={() => toggleEventRule(rule.id, !rule.enabled)}>
                  {rule.enabled ? "Pause" : "Activate"}
                </button>
                <button style={styles.buttonGhost} onClick={() => deleteEventRule(rule.id)}>Delete</button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={styles.muted}>{ruleMatcherText(rule.matcher)}</span>
                {rule.lastTriggeredAt && <span style={styles.muted}> · last fired {formatTime(rule.lastTriggeredAt)}</span>}
              </div>
              {rule.recentTriggers.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {rule.recentTriggers.slice(0, 3).map(trigger => (
                    <div key={trigger.eventId} style={styles.row}>
                      <span style={{ ...styles.statusChip, color: trigger.status === "failed" ? "#e53935" : "#4caf50" }}>{trigger.status}</span>
                      <span style={styles.muted}>{trigger.eventType}</span>
                      {trigger.createdTaskIds && trigger.createdTaskIds.length > 0 && (
                        <span style={styles.muted}>· created {trigger.createdTaskIds.length} task{trigger.createdTaskIds.length === 1 ? "" : "s"}</span>
                      )}
                      {trigger.error && <span style={styles.error}>{trigger.error}</span>}
                      <span style={styles.muted}>· {formatTime(trigger.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "windows" && (
        <div>
          <div style={styles.card}>
            <div style={styles.row}>
              <span style={styles.name}>New Execution Window</span>
              <span style={{ flex: 1 }} />
              <span style={styles.muted}>A deliberate synchronous batch of autonomous work — Run Now is a single execution.</span>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Window name</label>
                <input style={styles.input} value={windowForm.name} placeholder="e.g. Product Brief Research Session" onChange={ev => setWindowField("name", ev.target.value)} />
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.label}>Goal (optional)</label>
                <input style={styles.input} value={windowForm.goal} placeholder="e.g. Research and summarize the market" onChange={ev => setWindowField("goal", ev.target.value)} />
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Workflows to run</label>
              <div style={styles.filterRow}>
                {workflows.filter(wf => wf.enabled).length === 0 && <span style={styles.muted}>No enabled workflows yet — define one first.</span>}
                {workflows.filter(wf => wf.enabled).map(wf => (
                  <button
                    key={wf.id}
                    style={windowForm.workflowIds.includes(wf.id) ? styles.filterChipActive : styles.filterChip}
                    onClick={() => toggleWindowWorkflow(wf.id)}
                  >
                    {wf.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Agents / workers (optional — all agents when empty)</label>
              <div style={styles.filterRow}>
                {agents.length === 0 && <span style={styles.muted}>No agents registered.</span>}
                {agents.map(ag => (
                  <button
                    key={ag.id}
                    style={windowForm.agentIds.includes(ag.id) ? styles.filterChipActive : styles.filterChip}
                    onClick={() => toggleWindowAgent(ag.id)}
                  >
                    {ag.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...styles.field, width: 220 }}>
              <label style={styles.label}>Worker mode (optional)</label>
              <select style={styles.select} value={windowForm.workerMode} onChange={ev => setWindowField("workerMode", ev.target.value)}>
                <option value="">— Queue default —</option>
                <option value="noop">noop</option>
                <option value="headless">headless</option>
                <option value="terminal">terminal</option>
                <option value="ollama">ollama</option>
              </select>
            </div>

            {windowError && <div style={styles.error}>{windowError}</div>}
            {windowResult && <div style={styles.ok}>{windowResult}</div>}

            <button style={styles.button} onClick={createExecutionWindow}>Create Window</button>
          </div>

          {execWindows.length === 0 && (
            <div style={styles.empty}>No execution windows yet. A window runs one or more workflows as a synchronous session through the queue.</div>
          )}
          {execWindows.map(win => (
            <div key={win.id} style={windowFocus === win.id ? styles.cardFocused : styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{win.name}</span>
                <span style={{ ...styles.statusChip, color: win.status === "running" ? "#4caf50" : win.status === "completed" ? "#90caf9" : win.status === "cancelled" ? "#9e9e9e" : "#ffb74d" }}>
                  {win.status}
                </span>
                {win.workerMode && <span style={styles.chip}>{win.workerMode}</span>}
                {win.runCount > 0 && <span style={styles.chip}>{win.runCount} run{win.runCount === 1 ? "" : "s"}</span>}
                <span style={{ flex: 1 }} />
                {win.startedAt && <span style={styles.muted}>Started {formatTime(win.startedAt)}</span>}
                {win.durationMs !== undefined && <span style={styles.muted}>{formatDuration(win.durationMs)}</span>}
                {win.status === "planned" && (
                  <button style={styles.buttonGhost} onClick={() => startExecutionWindow(win.id)}>Execute Window</button>
                )}
                {(win.status === "planned" || win.status === "running") && (
                  <button style={styles.buttonGhost} onClick={() => cancelExecutionWindow(win.id)}>Cancel</button>
                )}
                <button style={styles.buttonGhost} onClick={() => setExpandedWindow(expandedWindow === win.id ? null : win.id)}>
                  {expandedWindow === win.id ? "Hide" : "Details"}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {win.goal && <span style={styles.muted}>{win.goal}</span>}
                <span style={styles.muted}>
                  {win.workflowNames.length > 0 && "Workflows: " + win.workflowNames.join(", ")}
                  {win.workerMode === "ollama" && " · LLM worker"}
                </span>
              </div>
              {expandedWindow === win.id && (
                <div style={styles.detail}>
                  <div>
                    <span style={styles.muted}>Workflows: </span>{win.workflowNames.join(", ") || "—"}
                    <span style={styles.muted}> · Agents: </span>{win.agentNames.join(", ") || "any registered agent"}
                    <span style={styles.muted}> · Tasks: </span>{win.taskCount}
                  </div>
                  <div>
                    <span style={styles.muted}>Runs — queued {win.runs.queued} · running {win.runs.running} · completed {win.runs.completed} · failed {win.runs.failed} · cancelled {win.runs.cancelled}</span>
                  </div>
                  <div>
                    <span style={styles.muted}>Validation — {win.findings.total} findings · agent review {win.findings.pendingAgentReview} · human review {win.findings.pendingHumanReview} · approved {win.findings.approved} · rejected {win.findings.rejected}</span>
                  </div>
                  {win.completionSummary && (
                    <div>
                      <span style={styles.ok}>Completion — completed {win.completionSummary.runsCompleted} · failed {win.completionSummary.runsFailed} · cancelled {win.completionSummary.runsCancelled}</span>
                      {win.completionSummary.findings > 0 && (
                        <span style={styles.muted}> · findings {win.completionSummary.findings}</span>
                      )}
                      {win.completionSummary.errors > 0 && (
                        <span style={styles.error}> · errors {win.completionSummary.errors}</span>
                      )}
                    </div>
                  )}
                  {runs.filter(r => r.windowId === win.id).length > 0 && (
                    <div>
                      <span style={styles.muted}>Runs: </span>
                      {runs.filter(r => r.windowId === win.id).map(r => (
                        <button key={r.id} style={styles.link} onClick={() => openRun(r.id)}>
                          {r.taskCode} · {r.status}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "activity" && (
        <div>
          {activity.length === 0 && (
            <div style={styles.empty}>No activity yet. Every lifecycle transition — runs, workflows, windows, event rules, schedules, findings, approvals — streams here as it happens.</div>
          )}
          {activity.map(ev => (
            <div key={ev.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{ev.label}</span>
                <span style={styles.chip}>{ev.type}</span>
                <span style={styles.muted}>{ev.source}</span>
                <span style={{ flex: 1 }} />
                <span style={styles.muted}>{formatTime(ev.timestamp)}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {ev.links.runId && <button style={styles.link} onClick={() => openRun(ev.links.runId!)}>run</button>}
                {ev.links.findingId && <button style={styles.link} onClick={() => openFinding(ev.links.findingId!)}>finding</button>}
                {ev.links.taskId && <button style={styles.link} onClick={() => openTask(ev.links.taskId!)}>task</button>}
                {ev.links.workflowId && <button style={styles.link} onClick={() => openWorkflow(ev.links.workflowId!)}>workflow</button>}
                {ev.links.ruleId && <button style={styles.link} onClick={() => openRule(ev.links.ruleId!)}>rule</button>}
                {ev.links.windowId && <button style={styles.link} onClick={() => openWindow(ev.links.windowId!)}>window</button>}
                {ev.links.scheduleId && <button style={styles.link} onClick={() => setTab("schedules")}>schedule</button>}
                {ev.links.employeeId && <button style={styles.link} onClick={() => openEmployee(ev.links.employeeId!)}>employee</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "tasks" && (
        <div>
          {tasks.length === 0 && (
            <div style={styles.empty}>No tasks yet. Tasks are created by hand (Create Task tab), by workflows, schedules, or event rules — then become runs in the queue.</div>
          )}
          {taskActionError && <div style={styles.error}>{taskActionError}</div>}
          {taskAction && <div style={styles.ok}>{taskAction}</div>}
          {tasks.map(t => (
            <div key={t.id} style={taskFocus === t.id ? styles.cardFocused : styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{t.title}</span>
                <span style={styles.muted}>{t.code}</span>
                <span style={{ ...styles.statusChip, color: t.status === "done" ? "#4caf50" : t.status === "in-progress" ? "#ffb74d" : "#9e9e9e" }}>{t.status}</span>
                {t.workStatus && <span style={styles.chip}>{t.workStatus}</span>}
                {t.priority && <span style={styles.chip}>{t.priority}</span>}
                <span style={{ flex: 1 }} />
                {t.agent && <span style={styles.muted}>assigned: <button style={styles.link} onClick={() => openEmployee(t.agent!)}>{t.agent}</button></span>}
                <button
                  style={editingTask?.id === t.id ? { ...styles.buttonGhost, backgroundColor: "var(--vscode-button-secondaryBackground, #2a2d2e)" } : styles.buttonGhost}
                  onClick={() => { if (editingTask?.id === t.id) setEditingTask(null); else startEditTask(t); }}
                >{editingTask?.id === t.id ? "Close" : "Edit"}</button>
                {confirmDeleteTask === t.id ? (
                  <button style={styles.buttonGhost} onClick={() => confirmDeleteTaskAction(t.id)}>Confirm delete</button>
                ) : (
                  <button style={styles.buttonGhost} onClick={() => requestDeleteTask(t.id)}>Delete</button>
                )}
              </div>
              {editingTask?.id === t.id && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={styles.label}>Title</label>
                    <input style={styles.input} value={taskEditForm.title}
                      onChange={e => setTaskEditForm(prev => ({ ...prev, title: e.target.value }))} />
                  </div>
                  <div style={{ minWidth: 110 }}>
                    <label style={styles.label}>Status</label>
                    <select style={styles.select} value={taskEditForm.status}
                      onChange={e => setTaskEditForm(prev => ({ ...prev, status: e.target.value }))}>
                      <option value="waiting">waiting</option>
                      <option value="in-progress">in-progress</option>
                      <option value="review">review</option>
                      <option value="done">done</option>
                      <option value="blocked">blocked</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  <div style={{ minWidth: 100 }}>
                    <label style={styles.label}>Priority</label>
                    <select style={styles.select} value={taskEditForm.priority}
                      onChange={e => setTaskEditForm(prev => ({ ...prev, priority: e.target.value }))}>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <label style={styles.label}>Assigned to</label>
                    <select style={styles.select} value={taskEditForm.agent}
                      onChange={e => setTaskEditForm(prev => ({ ...prev, agent: e.target.value }))}>
                      <option value="">— unassigned —</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <button style={styles.button} onClick={() => saveTaskEdit(t.id)}>Save</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkforceControlCenter;
