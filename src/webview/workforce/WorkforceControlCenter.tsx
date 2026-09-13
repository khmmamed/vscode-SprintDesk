// src/webview/workforce/WorkforceControlCenter.tsx
import * as React from "react";
import { acquireVsCodeApiOnce } from "../vscodeApi";

type WorkforceSection =
  | "employees"
  | "tasks"
  | "runs"
  | "approvals"
  | "schedules"
  | "workflows"
  | "activity"
  | "create-task";

type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type WorkerMode = "headless" | "terminal" | "noop" | "ollama";

interface RunDto {
  id: string;
  taskId: string;
  taskTitle: string;
  taskCode: string;
  agentName: string;
  agentId?: string;
  status: RunStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  result?: string;
  error?: string;
  summary?: { findings: number; errors: number };
}

interface EmployeeDto {
  id: string;
  name: string;
  role: "agent" | "human";
  status?: "idle" | "busy" | "offline";
  capabilities: string[];
  modelProvider?: string;
  agentTool?: string;
}

interface OverviewDto {
  runs: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  employees: { total: number; agents: number; idle: number; busy: number; offline: number };
}

interface CountsDto {
  pendingApprovals: number;
  schedules: number;
  workflows: number;
}

const EMPTY_OVERVIEW: OverviewDto = {
  runs: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
  employees: { total: 0, agents: 0, idle: 0, busy: 0, offline: 0 }
};

const EMPTY_COUNTS: CountsDto = { pendingApprovals: 0, schedules: 0, workflows: 0 };

const TABS: Array<{ key: WorkforceSection; label: string }> = [
  { key: "employees", label: "Employees" },
  { key: "tasks", label: "Tasks" },
  { key: "runs", label: "Runs" },
  { key: "approvals", label: "Approvals" },
  { key: "schedules", label: "Schedules" },
  { key: "workflows", label: "Workflows" },
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
  ok: { color: "#4caf50", fontSize: 12, marginBottom: 8 }
};

export const WorkforceControlCenter: React.FunctionComponent = () => {
  const [tab, setTab] = React.useState<WorkforceSection>("employees");
  const [runs, setRuns] = React.useState<RunDto[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeDto[]>([]);
  const [overview, setOverview] = React.useState<OverviewDto>(EMPTY_OVERVIEW);
  const [counts, setCounts] = React.useState<CountsDto>(EMPTY_COUNTS);

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

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload } = event.data || {};
      if (command === "SET_WORKFORCE_INIT") {
        if (payload?.section) setTab(payload.section);
        if (payload?.focusAgentId) {
          setForm(prev => ({ ...prev, agentId: payload.focusAgentId }));
          setTab("create-task");
        }
      } else if (command === "SET_WORKFORCE_RUNS") {
        setRuns(payload || []);
      } else if (command === "SET_WORKFORCE_EMPLOYEES") {
        setEmployees(payload || []);
      } else if (command === "SET_WORKFORCE_OVERVIEW") {
        if (payload?.overview) setOverview(payload.overview);
      } else if (command === "SET_WORKFORCE_COUNTS") {
        if (payload) setCounts(payload);
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
        if (payload?.error) {
          setError(payload.error);
          setBusy("error");
        } else if (payload?.payload) {
          setOutcome(payload.payload);
          setBusy(payload.payload?.ran ? "done" : "idle");
          setError("");
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

  const startCreateForAgent = (agentId: string): void => {
    setForm(prev => ({ ...prev, agentId }));
    setTab("create-task");
  };

  const agents = employees.filter(e => e.role === "agent");
  const runningCount = overview.runs.running;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Workforce Control Center</h1>
        <span style={styles.subtitle}>
          {overview.employees.agents} agents · {runningCount} running · {overview.runs.queued} queued
        </span>
      </div>

      <div style={styles.statRow}>
        <span style={styles.stat}>Queued {overview.runs.queued}</span>
        <span style={styles.stat}>Running {overview.runs.running}</span>
        <span style={styles.stat}>Completed {overview.runs.completed}</span>
        <span style={styles.stat}>Failed {overview.runs.failed}</span>
        <span style={styles.stat}>Approvals {counts.pendingApprovals}</span>
        <span style={styles.stat}>Schedules {counts.schedules}</span>
        <span style={styles.stat}>Workflows {counts.workflows}</span>
      </div>

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
          {agents.length === 0 && <div style={styles.empty}>No agents yet. Add an agent employee to get started.</div>}
          {agents.map(e => (
            <div key={e.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{e.name}</span>
                <span style={styles.statusChip}>{e.status || "idle"}</span>
                {e.modelProvider && <span style={styles.chip}>{e.modelProvider}</span>}
                {e.agentTool && <span style={styles.chip}>tool: {e.agentTool}</span>}
                <span style={{ flex: 1 }} />
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
          {runs.length === 0 && <div style={styles.empty}>No runs yet. Create a task &amp; run to see it here.</div>}
          {runs.map(run => (
            <div key={run.id} style={styles.card}>
              <div style={styles.row}>
                <span style={styles.name}>{run.taskTitle}</span>
                <span style={{ ...styles.statusChip, color: statusColor(run.status) }}>{run.status}</span>
                <span style={styles.muted}>Agent: {run.agentName}</span>
                <span style={{ flex: 1 }} />
                {run.startedAt && <span style={styles.muted}>Started {formatTime(run.startedAt)}</span>}
                {(run.status === "queued" || run.status === "running") && (
                  <button style={styles.buttonGhost} onClick={() => cancelRun(run.id)}>Cancel</button>
                )}
                <button style={styles.buttonGhost} onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                  {expandedRun === run.id ? "Hide" : "Details"}
                </button>
              </div>
              {run.status === "completed" && run.summary && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  <span style={styles.ok}>Findings: {run.summary.findings}</span>{" "}
                  <span style={run.summary.errors > 0 ? styles.error : styles.muted}>Errors: {run.summary.errors}</span>
                  {run.attempts > 1 && <span style={styles.muted}> · attempt {run.attempts}</span>}
                </div>
              )}
              {run.status === "failed" && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  <span style={styles.error}>Failed</span>
                  {run.error && <span style={styles.muted}> · {run.error}</span>}
                </div>
              )}
              {expandedRun === run.id && (
                <div style={styles.output}>
                  {run.result && <div><b>Output</b>{"\n"}{run.result}</div>}
                  {run.error && <div>{run.result ? "\n\n" : ""}<b>Error</b>{"\n"}{run.error}</div>}
                  {!run.result && !run.error && <div>No output captured.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "approvals" && (
        <div style={styles.empty}>
          Approvals: {counts.pendingApprovals} pending. The approval gate review UI lands in a later increment.
        </div>
      )}
      {tab === "schedules" && (
        <div style={styles.empty}>
          Schedules: {counts.schedules} defined. The schedules management UI lands in a later increment.
        </div>
      )}
      {tab === "workflows" && (
        <div style={styles.empty}>
          Workflows: {counts.workflows} defined. The workflow editor UI lands in a later increment.
        </div>
      )}
      {tab === "activity" && (
        <div style={styles.empty}>
          Activity: event feed UI lands in a later increment. Runs created here are already captured in the event stream.
        </div>
      )}
      {tab === "tasks" && (
        <div style={styles.empty}>
          Tasks assigned to employees appear here in a later increment. Create one via the Create Task tab.
        </div>
      )}
    </div>
  );
};

export default WorkforceControlCenter;
