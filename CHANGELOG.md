# Change Log

All notable changes to the "vscode-SprintDesk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.11.0] - 2026-09-14 Workforce Control Center & Findings

### v0.11 Slice 1 — Control Center shell & end-to-end execution

- **The v0.11 line began with the Control Center shell:** `sprintdesk.openWorkforce` opened the dedicated
  workforce panel (Employees / Runs / Create Task & Run tabs), added the 7-section Workforce tree with live
  counts, made `queueService.createRun` the single source of truth for run creation, introduced the Ollama
  worker runtime (modelProfile-only agents) and structured run summaries, and hardened run lifecycle + error
  surfacing — full detail is recorded as **v0.10 Slice 1** below (commit `1f19072`).
- Every later slice (findings, configuration, event rules, validation, runs/queue, windows, lifecycle polish)
  is built on top of this foundation.

### v0.11 Slice 2 — Findings as first-class objects

- **First-class `Finding`:** new `Finding` type (title, description, evidence, structured `source {runId, type, reference}`,
  severity/confidence/category, suggested task/workflow/priority, `pending → approved | rejected` lifecycle)
  persisted to `.SprintDesk/workforce/findings.yml` via `FindingStore`.
- **Materialization from runs:** `finishRun` captures the `Findings:` section of completed run output into real
  `Finding` records attributed to the run + agent; deterministic identity (`runId` + normalized bullet hash) makes
  re-materialization idempotent even if bullets reorder.
- **Human validation:** `findingsService.updateStatus` approves/rejects pending findings under the existing
  `approval:review` permission (no new authorization concept); emits `finding.created` / `finding.resolved` events.
- **Control Center:** new `Findings` tab (severity/confidence chips, Approve / Reject) + `Findings (N)` tree nav row
  with pending count; dashboard strip shows pending findings. No separate tree provider — unified architecture.
- **Hardening:** Control Center `WORKFORCE_RESPONSE` now surfaces backend errors/success correctly (previously the
  payload/error were read from the wrong nesting level).
- Architecture: `docs/v0.11-upcomming.md`. Version stays `0.9.0` during development.

### v0.11 Slice 3 — Agent model/configuration UI

- **Configure agents from the Control Center:** Employees tab gains a `Configure` action and inline form to edit
  `modelProfile` (provider/model/baseUrl), `agentConfig` (tool/command), and `capabilities` — no YAML editing,
  and the creating-agent flow is now self-contained. Permissions are shown read-only.
- **Gate-aware apply:** `workforceService.applyConfigChange` routes changes through the sanctioned `config-change`
  approval path — applies immediately when the gate is `auto` (default), otherwise creates a pending approval
  (`apply-config`) that resolves via the existing approval resolver.
- **Control Center round-trip:** `WORKFORCE_UPDATE_AGENT` applies/requests and pushes `AGENT_CONFIGURED` (outcome +
  refreshed employee) back to the webview; tree + snapshot refreshed.
- Architecture: `docs/v0.11-upcomming.md`. Version stays `0.9.0` during development.

### v0.11 Slice 4 — Event Rules (event-based asynchronous automation)

- **Event Rules turn emitted events into workflow runs** — the event-based counterpart to the time-based scheduler,
  reusing the existing workflow engine and queue (no new engine, no new scheduler):
  `Event → Event Rule → Workflow → Task/Run → Finding → Validation`.
- **Conditions match existing `EventRecord` data** by event `type`, `source`, and `payload` keys (dotted paths
  supported) with optional value matching; an empty matcher matches any event.
- **Deterministic, idempotent, re-entrancy-safe triggering:** rules are evaluated in id order, each event triggers a
  rule at most once (bounded recent-trigger log), and a module-level guard prevents workflow-emitted events from
  re-evaluating rules mid-trigger (no recursion) while still recording them.
- **Rules manage workflows through the Control Center:** new Event Rules tab with a create form (conditions +
  workflow picker), active/paused toggle, delete, per-rule run count, last fired time, and the 3 most recent
  trigger/result lines (status, event type, created task count, error). The Workflows tab now lists workflows
  read-only to back the picker.
- **Authorization and audit:** rule CRUD requires `event-rule:manage` (granted to `lead` and `human` roles via the
  existing policy engine — policy overrides keep working); every create/update/enable/disable/delete/trigger is
  written to the audit trail, and triggers emit an `eventrule.fired` event into the existing stream.
- **Narrow trigger hook:** events wire to rules through a subscriber hook (`setEventProcessor`) on `emitEvent`,
  keeping `events.ts` free of import cycles with the workflow engine.
- Tests: matching / non-matching / disabled / idempotent / re-entrancy / auto-wire via `emitEvent` / audit /
  missing-workflow failure / permission checks / update-toggle-delete. Version stays `0.9.0` during development.

### v0.11 Slice 5 — Agent Validation / Review

- **Agents validate; humans decide.** Every `Finding` now carries an orthogonal (non-breaking) agent-validation
  dimension alongside the existing `pending | approved | rejected` human status:
  `PENDING → AGENT REVIEW → VALIDATED → HUMAN REVIEW → APPROVED / REJECTED` with the full history on the record.
- **Validation state without touching human status:** findings are added with `agentValidationState: 'requested'`
  (`agentValidationRequestedAt`), and `findingsService.validateFinding` records `agentReview`
  (`validatorId`/`validatorName`, `recommendation: recommend-approve | recommend-reject | request-revision`,
  `confidence`, `reason`, `validatedAt`) and flips the state to `validated` — it never changes `status`, so an
  agent can recommend but never silently approve. `requestAgentValidation` re-exposes a finding idempotently.
- **Authorized validators only:** `finding:validate` permission granted to the `reviewer` role in `DEFAULT_POLICY`
  (policy overrides keep working); unauthorized attempts throw and leave the finding untouched.
- **Auditable + observable:** `finding.validation.requested` (on materialization) and `finding.validated` events join
  the existing stream, and every validation writes an `finding.validated` audit entry (payload includes
  recommendation/confidence/reason). Duplicate validation attempts are idempotent — no second event/audit.
- **Control Center:** Finding cards show a review-state chip (agent review → `pending agent review/human review`),
  the recommendation (colored), validator, confidence %, reason, and validation time; pending unvalidated findings
  gain a **Validate** action with an inline form (validating-agent picker filtered to `finding:validate` holders,
  recommendation, confidence, reason). The dashboard replaces "Findings N pending" with **Agent Review N** and
  **Human Review N** counters; human Approve/Reject remains on every pending finding.
- Tests: state entry on creation, authorized validator records within an unchanged `pending` status, unauthorized
  blocked, persisted review, duplicate-safe validation, no human-approval bypass, idempotent re-request,
  agent-vs-human review counts, plus events + audit assertions. Version stays `0.9.0` during development.

### v0.11 Slice 6 — Operational Execution / Runs + Queue Visibility

- **Runs tab is now a live operations console.** Each run card shows title, code, status (including `retrying`
  backoff from `availableAt`), agent, attempt count, start time, and duration; cards expand into full run detail:
  task, originating **Workflow**, **Event Rule trigger** (`<rule> (<eventType>)`), agent, worker mode (queue
  setting, read-only), model, attempt, created/started/finished timestamps, duration, linked findings with their
  review state, and the raw output/error blocks.
- **Run actions via existing queue ops — no new execution machinery:** **Cancel** on queued/running, **Retry** on
  failed/cancelled, and **Run Again** on completed all route through `queueService` (`run:create`/`run:cancel`
  permission gates preserved); **Process Queue** runs one queue pass and reports claimed/started/skipped back to
  the panel.
- **Operational strip is clickable:** Workers (`busy/max`), Running, Queued, Retrying, Completed, Failed, Findings,
  Agent Reviews, Human Reviews, Approvals, Schedules, Workflows, Event Rules counters now navigate to the
  corresponding filtered view instead of being dead readouts.
- **Status filters:** Runs list filters All / Queued / Running / Retrying / Completed / Failed / Cancelled;
  Findings list filters All / Agent Review / Human Review / Approved / Rejected — both client-side over the
  existing snapshot payloads.
- **Queue status header:** live worker mode, occupancy (`allocated/maxConcurrentRuns`), and `attempts > 1` count
  above the runs list; queue snapshot counters available in the panel.
- **Read-only run reports (no Run schema change):** `observability.getRunsByFilter` (status + retrying
  classification), `runDetail` (task / employee / workflow / event-rule trigger via the existing recent-trigger
  log / findings by run / duration), and `getQueueSnapshot` (run counts, waiting-for-retry, multi-attempt, worker
  mode, occupancy, busy/idle/offline agents).
- **Live refresh from the existing event stream:** new additive `subscribeEvents` in `events.ts` (keeps the
  `setEventProcessor` hook used by Event Rules intact); the Control Center subscribes, debounces (~150ms),
  filters operational event prefixes (`run.`/`finding.`/`workflow.`/`eventrule.`/`queue.`/`schedule.`), and
  pushes a fresh snapshot — no new state store.
- Tests: run listing + status filtering, retrying classification, queue pass (claim/start/skip), queue snapshot
  counts and occupancy, run detail (task/agent/duration/linked findings), run → finding → validation chain,
  run → workflow → event-rule trigger chain, retry/cancel permission handling, and snapshot/counter refresh
  across run state changes. Version stays `0.9.0` during development.

### v0.11 Slice 7 — Execution Windows / Synchronous Work

- **Execution Windows are a new persistent domain object** repurposing the legacy "Sprint" concept for
  **deliberate synchronous batches** of work: `Human → Execution Window → Workflow → Task/Run → Queue → Worker
  → Finding → Validation → Human Decision`. Windows live in `.SprintDesk/workforce/executionWindows.yml`
  (`ExecutionWindowStore`, same pattern as workflows/event rules) with name, goal, selected workflows, selected
  agents, worker mode, status `planned | running | completed | cancelled`, timestamps, task/run ids, and a
  completion summary — so every window is historical, auditable, and reviewable after the fact. The old
  project-management Sprint model is not brought back and the legacy `Sprint` data service is untouched.
  **Run Now** (single immediate execution) and **Execution Window** (synchronous session) are distinct paths in
  the UI.
- **Start scope only — no new classification/validation logic:** `startExecutionWindow` (async, awaits the
  workflow engine) plans tasks + queued runs for each selected workflow (ids via `task.runId` /
  `runs.findByTaskId`), assigns agents round-robin from the window's agent pool (selected ids, or all agents;
  filtered to non-offline + `run:create` permission, idle-first), and writes `run.agentId` + `task.agent`.
  Runs still execute through the existing queue/workers exactly like any other run.
- **Completion without polling:** a module-level subscriber reacts to run lifecycle events for a running window —
  all of its runs terminal → window finalizes (`completed` + `completionSummary {runsCompleted, runsFailed,
  runsCancelled, findings, errors}`); otherwise it kicks one guarded queue pass (respecting worker mode and
  `maxConcurrentRuns`). `setAutoAdvanceEnabled` test hook keeps tests deterministic.
- **Cancel semantics:** cancels outstanding queued/running runs through `queueService.cancelRun` and marks the
  window `cancelled` with `finishedAt`; only `planned`/`running` windows can be cancelled.
- **Control Center:** new **Execution Windows** tab with a create form (name, goal, enabled-workflow and agent
  pickers, optional worker mode) plus per-window actions — **Execute Window** (start), **Cancel**, **Details**
  (workflows/agents, runs breakdown, findings + validation progress, duration, completion summary). Windows stat
  chip in the operational strip navigates to the tab. Counts + DTOs merged from
  `observability.getExecutionWindowReport`.
- **Observability:** `getExecutionWindowReport` joins workflow/agent names, breaks down runs by status and
  findings by validation stage (agent review / human review / approved / rejected), and reports duration —
  reused by both the DTO layer and tests.
- **Events + audit:** windows emit `execwindow.created/started/completed/cancelled` into the existing stream and
  write `execwindow.create/start/complete/cancel` audit entries; the operational prefix list (`execwindow.`)
  keeps the Control Center live-refreshing.
- Tests: create/persist, missing-workflow rejection, start → tasks+runs+agent assignment, non-assignable agents
  skipped, cancel, drive-through-queue to completion (noop), validation progress in the report, and
  audit/event milestones. Version stays `0.9.0` during development.

### v0.11 Slice 8 — Control Center polish & end-to-end lifecycle

- **One screen, the whole lifecycle.** `sprintdesk.openWorkforce` now opens on the **Runs** tab (default) so a
  new user sees the live queue immediately, a loading banner appears until the first snapshot arrives, and a
  **live event ticker** under the dashboard strip streams the most recent lifecycle transitions (window
  created/started, run finished, finding created/validated/resolved, rule fired) with one-click contextual links.
- **Full lifecycle nav — no dead ends.** Runs link to their Task, Workflow, Event Rule trigger, Agent, Execution
  Window, and Findings; Findings link back to their Run and Validator; Event Rules link to their Workflow;
  Execution Windows expand to the actual run chips (`.SprintDesk` files never need opening). Focus-clicking any
  referral highlights the target card (`cardFocused` accent border) on its tab.
- **Activity tab turns the stored event stream into a browsable history:** every `run.*/finding.*/workflow./
  eventrule./execwindow./schedule./approval.*` transition is listed with type, source, timestamp, and chips that
  jump to the run/finding/task/workflow/rule/window/schedule/employee it concerns.
- **Four placeholder tabs became real panels — Tasks** (title, code, status, work status, priority, clickable
  assigned agent), **Approvals** (read-only list with type/status/target/reason and decision details; resolving
  the UI stays a later increment), **Schedules** (name, kind + cron/interval, autonomy level, run count, last run;
  autonomy semantics explained inline), and **Activity**. Each lands with a deliberate empty state that says what
  the tab is for and how to populate it.
- **Action feedback everywhere:** Cancel / Retry / Run Again and Approve / Reject / Validate report success or
  error inline (`runAction` / `findingAction`), matching the existing Create Event Rule / Execute Window /
  Configure Agent feedback; backend errors from the command layer surface into the right line.
- **Command layer DTOs widen without new state:** runs now carry `windowId`/`windowName`; new snapshots
  `SET_WORKFORCE_ACTIVITY` (recent events + resolved labels/links), `SET_WORKFORCE_APPROVALS`, and
  `SET_WORKFORCE_SCHEDULES` are pushed from the existing stores; Cancel / Decide / Validate now answer with
  `{ cancelled, decided, validated }` success payloads the webview can render.
- **Deterministic end-to-end lifecycle smoke (no Ollama):** one test drives the entire chain
  `Execution Window → workflow → queued run → noop worker completion → findings materialization → agent
  validation → human approve` and asserts the activity stream at each milestone; two companion tests prove the
  async alternatives `Event Rule → Workflow → Task → queued Run` and `Schedule → Task → queued Run` (autonomy 2,
  interval idempotency), all fully re-runnable in CI.
- UI-1 / v0.11 is now functionally complete end to end. Released as `0.11.0`.

## v0.10 — pre-release milestone (superseded by 0.11.0)

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
- **Ollama no longer requires `agentConfig`:** a `modelProfile` alone is sufficient for the LLM worker
  (CLI modes `noop`/`terminal`/`headless` still need `agentConfig.tool`); the "Agent not configured"
  failure is now mode-specific and actionable.
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