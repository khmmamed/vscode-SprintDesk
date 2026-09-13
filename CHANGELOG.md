# Change Log

All notable changes to the "vscode-SprintDesk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased] - v0.10 Workforce Control Center

### v0.10 Slice 1 — Control Center & end-to-end execution

- **Workforce Control Center webview:** `sprintdesk.openWorkforce` opens a dedicated `?view=workforce` panel
  with tabs for Employees, Runs, Create Task & Run, and counted placeholders for Approvals / Schedules /
  Workflows / Activity. The legacy project-management webview is untouched.
- **7-section Workforce tree:** `Employees` (teams → members → unassigned), `Tasks` (agent-assigned),
  `Runs` (recent runs with status icons), plus Approvals / Schedules / Workflows / Activity nav rows with live
  counts that open the Control Center. Existing employee/team commands preserved.
- **End-to-end **Create Task & Run** flow:** create task → assign employee → `queueService.createRun` →
  `startRun` → `executeRun` → `finishRun`, with live `RUN_UPDATED` pushes to the webview. Queue state
  transitions remain owned by `QueueService`.
- **`queueService.createRun(taskId, agentId)`:**
  new single source of truth for run creation (permission gate + offline check + task/run tagging). The MCP
  `sprintdesk_runsCreate` handler now routes through it — identical MCP behavior.
- **Ollama worker runtime:** new `WorkerMode 'ollama'` executes the task through the employee's LLM
  `modelProfile` (falling back to `agentConfig.model`), emitting `Findings:` / `Errors:` sections.
  `processQueue` quickpick and the Create Task form expose the mode.
- **Structured run summaries:** `Run.summary { findings, errors }` computed by `finishRun` via
  `summarizeRunOutput` (explicit sections with bullet fallback).
- **New commands:** `sprintdesk.openWorkforce`, `sprintdesk.createTaskForEmployee` (agent tree row),
  `sprintdesk.cancelRun` (run tree row).
- **Run lifecycle hardening:** control-center/tree cancel works out of the box (`run:cancel` granted to the
  default `agent` role); command-layer errors (offline agent, no agent assigned, missing permission) surface
  in the webview instead of hanging; the Workforce tree refreshes on every run transition driven by the
  Control Center; the Create & Run message distinguishes approval-required from plain queued.
- Architecture: `docs/v0.10-control-center.md`. Version stays `0.9.0` during development.

## [0.9.0] - 2026-09-13

### v0.9 — Declarative Workflow DSL

- **Workflow definitions:** `validateWorkflow` DSL with four step types — `task`, `loop`, `tool`, `condition`
  (step ids `[a-z][a-zA-Z0-9_.-]*`, bounded `maxIterations`, `iterateVar` injection, `{var}` interpolation,
  condition evaluation on step status only).
- **Deterministic engine:** `executeWorkflow` creates Tasks + queued Runs through the queue (never bypasses
  `QueueService`), tool steps always route through capability-gated MCP `callServerTool`, bounded loops,
  fail-fast abort unless `continueOnError` flags an escaped step, `workflow.completed` / `workflow.failed`
  lifecycle events.
- **`WorkflowStore`:** `.SprintDesk/settings/workflows.yml`.
- **Ground truth:** LLM and tool outputs remain data, never authorization — conditions branch on step status
  (`always` / `never` / `step-status`), keeping the DSL deterministic and audit-safe.
- Full architecture (v0.7–v0.9) documented in `docs/v0.9-workforce-guide.md`.

## [0.8.0] - 2026-09-13

### v0.8 — Deterministic Scheduler & Autonomy

- **`ScheduleStore`** (`.SprintDesk/settings/schedules.yml`) with `cron` and `interval` schedule kinds.
- **`scheduler.runSchedulerPass`:** deterministic, idempotent firing over due schedules; `availableAt`
  backoff gating; `run.queued` via the queue (no scheduler-side execution).
- **Autonomy levels** (`0`–`3`, default `1`) gate classified work (e.g., `critical` approval) — read-only
  operating bounds for the scheduler.
- No new MCP tools; scheduler composes existing queue primitives.

## [0.7.0] - 2026-09-13

### v0.7 — Providers, Events, Retries & Approvals

- **LLM providers:** ollama / openai clients behind a credential facade; `Employee.modelProfile` selects the
  model per employee (experimental, no autonomous calls yet).
- **MCP client & registry:** hand-rolled JSON-RPC client, `McpServerStore` (`.SprintDesk/mcp/servers.yml`),
  capability-gated external tool calls via `sprintdesk_mcpCall`; registry tools
  (`mcpServersList/Add/Update/Remove`, `mcpToolsList`, `mcpCheck`).
- **Lifecycle events:** `EventStore` (`.SprintDesk/data/events.yml`) + `emitEvent` on run / queue / employee
  transitions; `sprintdesk_eventsPublish`, `sprintdesk_eventsList`, `sprintdesk_activitySummary`.
- **Run retries:** `requeueRun` with `attempts`, per-run timeout `runTimeoutMs`, failure classification, and
  `availableAt` backoff gating (`maxRunRetries`, `retryBackoffMs`).
- **Approval gates:** `GateMode` `auto | manual` (`task-assignment`, `run-execution`, `config-change`) with
  `ApprovalStore` (`.SprintDesk/workforce/approvals.yml`) and tools `gatesGet`, `gatesSet`, `approvalsList`,
  `approvalsApprove`, `approvalsReject`, `employeeConfigure`.
- **Stuck-run fix:** workers mark runs that time out so the queue can requeue them.

## [0.6.0] - 2026-09-13

### v0.6 — Queue, Scheduler & Worker Runtime

- **Queue settings:** `QueueSettingsStore` (`.SprintDesk/workforce/queue.yml`) with `enabled`, `maxConcurrentRuns`, `autoAssignUnassigned`, `workerMode`, `pollIntervalMs`.
- **Deterministic scheduler pass:** `queueService.processQueue` claims queued runs in `createdAt asc → attempts asc → id asc` order; per-employee busy (running or claimed-this-pass) and global capacity caps; explicit skip reasons (`task-not-found`, `task-closed`, `employee-not-found`, `employee-offline`, `no-permission`, `concurrency-limit`). `dryRun` previews without writing.
- **Single transition path:** `startRun` / `finishRun` / `cancelRun` own every run state change plus employee status and task `workStatus` sync, with audit events (`run.start`, `run.finish`, `run.cancel`). `run:cancel` gate enforced; `run:update` permission added for agent/lead.
- **Worker runtime boundary:** `WorkerRuntime` with `workers/worker.ts` orchestration, headless (spawn, shell:false with win32 ENOENT fallback), VS Code terminal, and deterministic noop worker. `executeRun` requires run `running` + employee `agentConfig` and delegates the final transition to `finishRun`. Command-building/role-loading extracted to `workers/commandBuilder.ts` (shared with legacy `agentRunner`).
- **New MCP tools (44 → 49):** `sprintdesk_queueGet`, `sprintdesk_queueProcess`, `sprintdesk_runsCancel`, `sprintdesk_runsUpdate`, `sprintdesk_tasksAutoAssign`.
- **Explicit opt-in assignment:** `sprintdesk_tasksAutoAssign` (and `rankEmployees`) assign only on explicit call — `queueProcess` never auto-assigns.
- **UI & CLI:** `SprintDesk: Process Queue` command with worker-mode picker; headless CLI worker (`npm run worker -- [ws] --worker=noop --limit=N`).
- Employee ID uniqueness fix in `addEmployee` (`emp_<ts>_<uuid8>`).
- Contract documented in `docs/v0.6-worker-contract.md`.

## [0.5.0] - 2026-09-13

### v0.5 — Workforce Semantics

- **Skill catalog & matching:** `SkillStore` (`.SprintDesk/workforce/skills.yml`) with 8 seeded skills, aliases, and a default task-type → skill mapping; deterministic `capabilityService.rankEmployees` ranking (coverage → load → status → name → id) for LLM-free assignee selection.
- **RBAC policy:** `PolicyStore` (`.SprintDesk/workforce/policy.yml`) with role → permission matrix (`lead/developer/reviewer/observer/agent/human`) and per-employee allow/deny overrides.
- **Lifecycle gates:** enforced permissions on `sprintdesk_tasksAssign`, `sprintdesk_tasksClaim`, and `sprintdesk_runsCreate`; offline employees excluded from ranking work.
- **New MCP tools (40 → 44):** `sprintdesk_skillsList`, `sprintdesk_skillsUpsert`, `sprintdesk_policyGet`, `sprintdesk_recommendEmployees`.
- **UI hooks:** `SprintDesk: Recommend Assignee` on tasks, catalog-based skill picker in Add Employee, skills + permissions in workforce tooltips.
- **Standup:** "Matching Readiness" section (catalog size, full/partial/uncovered open tasks, aggregate skill gaps).
- Contract documented in `docs/v0.5-workforce-contract.md`.

## [0.4.0] - 2026-09-13

### Foundation (M1-M6)

- **Workforce (M5):** Employee/team model with YAML persistence under `.SprintDesk/workforce/`, workforce sidebar tree (teams, members with human/agent kind, status, skills), commands (Add Employee, Create Team, Assign to Team, Sync Workforce from Team), and dangling-lead cleanup on reassignment.
- **MCP servers (M6):** HTTP and stdio transports with shared tool core, expanded `sprintdesk_*` toolset (40 tools), auto-managed `.SprintDesk/project.mcp.json`, and headless CLI entry points (`npm run mcp`, `npm run standup`).
- **Data & persistence (M1/M2):** YAML store layer, migration service, audit/event/history tracking, run records.
- Settings, history service, and interactive command plumbing.

### UI & workflows

- MCP Server integration for AI agents (port 3847)
- Team management view with Git sync
- History tracking view
- Sprint calendar visualization
- Interactive React webview UI for tasks/backlogs/epics
- Drag & drop support between sprints, epics, and backlogs
- Keyboard shortcuts: Ctrl+Shift+T (Add Task), Ctrl+Shift+Q (Add Quickly)
- Multiple repository/project support
- Task preview and raw editing
- Updated task provider with enhanced tree view
- Improved sprint file handling