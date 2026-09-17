# SprintDesk Current Features

**Version 1.0.0 — Plan-native.** SprintDesk is a Visual Studio Code extension for **autonomous, policy-gated
workforce orchestration**. A **Plan is the only unit that can enter execution**; the legacy
Task/Epic/Backlog/Sprint project-management surface is removed from the active runtime. All runtime state lives
under `.SprintDesk/database/`.

See [`v1.0.0-proposal.md`](v1.0.0-proposal.md) for the canonical architecture and slice plan, and
[`v0.9-workforce-guide.md`](v0.9-workforce-guide.md) / [`v0.11-upcomming.md`](v0.11-upcomming.md) for the
workforce runtime lineage (these v0.9–v0.12 documents are historical; where they mention Tasks, the v1.0
equivalent is a Plan).

---

## Plan-Native Core (v1.0)

### 🔄 The lifecycle

```
Input → Plan → Organize → Dispatch → Run → Finding → Validate → Checkpoint → Deploy
```

- **Orchestrator** ("what work should exist?") ingests `inputs/*.md` and writes semantic `plans/PLAN-*.md`
  artifacts with an initial classification.
- **Organizer** ("what is this, how urgent, who, when?") re-evaluates existing plans only — re-classification,
  priority, dependencies, execution mode, and agent selection — and writes the registry, never plan content.
- **Dispatcher** enqueues an organized, ready plan through `queueService.createRun(planId, agentId)`.
- **Validator** turns a completed run into a `PlanValidation` record and, on a pass, creates a **Checkpoint** and
  closes the cycle. **Deploy** is a separate, human-authorized step.

Two custody rules are enforced by tests: the Organizer never writes `plans/*.md`, and only the Dispatcher (never
the Organizer) touches the queue.

### 📥 Inputs
- Drop `inputs/*.md` (Basket 1) or use the Control Center **Create Input** form.
- `listInputs()` discovers inputs not yet registered (mtime + content-hash dedup); `ingestInput()` creates an
  `InputRecord` and opens a `Cycle`.
- `orchestrate()` decomposes an input into one or more plans, capped by `maxPlansPerPass` (default 5) and deduped
  by normalized objective. Emits `plan.created` / `input.planned` / `cycle.opened`.

### 🗂 Plans
- `plans/PLAN-*.md` artifacts (front-matter `id`/`version`/`lineage`; body Objective / Implementation / Acceptance
  Criteria / Constraints) written only by the Orchestrator content path.
- Registry `database/plans.yml`: six-axis classification (`original` and `current`), organization status/version,
  scheduling, execution, validation, and lineage.
- Control Center **Plans** tab; MCP `plansList` / `plansGet` / `plansReplan`.

### 🔁 Cycles & Checkpoints
- `database/cycles.yml` opens on ingest and closes on a passing validation (`closed-pass`) or escalation.
- `database/checkpoints.yml` records `CHK-####` (planId, artifacts, status `ready | deployed`).
- **Deploy authorization** is human-gated by default (`deploy` gate `manual`, `plan:deploy` permission, approval
  op `authorize-deploy`); there is never an automatic deploy path. MCP `checkpointsList` /
  `checkpointsApproveDeploy` / `checkpointsRejectDeploy`; events `deploy.authorized|rejected`,
  `checkpoint.deployed`.

### 🧭 Organizer engine
- `runOrganizerPass()` reconciles classification, dependencies, runnability, execution mode, and assignment
  (`rankEmployees`); convergent — a no-change pass emits nothing.
- A fundamentally wrong plan emits `plan.replanning.requested` (recovery turns it into a new input) instead of
  being silently rewritten.
- Driven by `organize` schedules, events (`organizer.trigger`), and the manual **Run Organizer** / MCP
  `organizerRun` path.

---

## Workforce Control Center (v1.0)

A single webview (`sprintdesk.openWorkforce`) operates the whole lifecycle with no YAML/CLI/MCP required.

- **Tabs:** Employees / Plans / Inputs / Checkpoints / Cycles / Runs / Findings / Plan Classifications /
  Approvals / Schedules / Workflows / Event Rules / Execution Windows / Activity / Create Input.
- **Dashboard strip + live event ticker** with clickable counters and cross-entity navigation (no dead ends).
- **Actions:** run Cancel / Retry / Run Again / Process Queue, finding Validate / Approve / Reject, window
  Execute / Cancel, deploy Approve / Reject, and organizer force-run — each with inline success/error feedback.
- **Deliberate states:** loading (banner until first snapshot), empty (per-tab guidance), error, in-progress, and
  completed.

---

## Workforce & Runtime

### 👥 People & Employees
- Role-split identity under `.SprintDesk/people/` — `humans.yml`, `agents.yml`, `teams.yml`.
- Skill catalog with aliases and required-skill mapping (`database/skills.yml`, 8 seeded).
- Deterministic `rankEmployees` recommendations (coverage → load → status → name → id); teams from manual setup or
  Git-history sync.

### 🔐 RBAC & Policy
- Role → permission matrix (`lead` / `developer` / `reviewer` / `observer` / `agent` / `human`) with per-employee
  allow/deny overrides (`database/policy.yml`, created on demand).

### 🔄 Queue, Runs & Workers
- Plan → Run → Queue → Worker pipeline (`database/executions.yml`, internal key `runs`).
- Deterministic queue pass (`createdAt asc → attempts asc → id asc`) with explicit skip reasons
  (`plan-not-found`, `plan-not-runnable`, …).
- Single transition path `startRun` / `finishRun` / `cancelRun` with audit events.
- Worker runtimes: headless (spawn), terminal, noop, and ollama.

### 🔁 Retry policy
- `maxRunRetries`, `retryBackoffMs` backoff gating, `runTimeoutMs` per-run timeout, failure classification, and
  `availableAt` requeue gating.

### 📅 Scheduler & Autonomy
- Deterministic cron/interval schedules (`settings/schedules.yml`) with `ScheduleAction` `plan` | `classify` |
  `organize`; idempotent firing.
- An interval driver honors `queueSettings.enabled` / `pollIntervalMs` (default `enabled: false`, so nothing runs
  until opted in); headless `npm run scheduler` CLI.
- Autonomy levels `0–3` (default `1`) bound classified work.

### 🧠 LLM Providers
- ollama / openai clients behind a credential facade (`settings/credentials.secret.json`).
- Per-employee `modelProfile` selection; agents configured with provider/model/capabilities from the UI.
- Model output is data, never authorization.

### 🔌 MCP Servers & Toolset
- Built-in `sprintdesk_*` toolset over HTTP/stdio (43 tools across Agents, Runs, Queue, Events, History, Audit,
  Context, Workforce, MCP, Approvals, Inputs, Plans, Checkpoints, Cycles, Organizer).
- External MCP server registry (`mcp/servers.yml`) with capability-gated `mcpCall`.

### 📝 Findings & Validation
- Findings materialized from completed-run output as first-class persisted objects
  (`database/findings.yml`) with severity/confidence/category/suggested workflow and a `planId` reference.
- Agent validation (recommendation, confidence, reason; `finding:validate`) then human decision
  (`approval:review`) — agents recommend, humans decide.

### ✅ Reviews & Approval Gates
- `auto` / `manual` gates configured in `settings/queue.yml` (`approvalGates`):
  `runExecution` (`auto`), `configChange` (`auto`), `planClassification` (`auto`), `deploy` (`manual`).
- Pending approvals (`database/approvals.yml`) with approve/reject tools and inline Control Center decisions.

### 📦 Execution Windows
- Deliberate synchronous batches: `Human → Window → Workflow → Plan/Run → Queue → Worker → Finding → Validation
  → Human Decision` (`database/executionWindows.yml`).
- Auto-advance to completion via run events; cancellation; persisted completion summary.

### 📡 Events & Event Rules
- Lifecycle events (`database/events.yml`) on run / queue / plan / finding transitions.
- Event Rules: idempotent, re-entrancy-safe `Event → Rule → Workflow → Plan/Run` async automation.

### 📋 Workflow DSL
- Declarative `task` / `loop` / `tool` / `condition` workflows (`settings/workflows.yml`); a `task` step now
  materializes a Plan (the DSL key rename is tracked debt).
- Deterministic, bounded engine; `continueOnError` escape hatch; tool steps route through MCP; conditions read
  step status only — LLM/tool output stays data.

---

## Storage Layout (v1.0 invariant)

```
.SprintDesk/
  database/        # ALL runtime state
    inputs.yml  plans.yml  executions.yml  checkpoints.yml  cycles.yml
    events.yml  audit.yml  findings.yml  approvals.yml  policy.yml
    skills.yml  eventRules.yml  classification.yml  executionWindows.yml
  settings/        # configuration
    queue.yml  schedules.yml  workflows.yml  credentials.secret.json
  people/          # identity
    humans.yml  agents.yml  teams.yml
  inputs/          # input artifacts (Basket 1)
  plans/           # semantic Plan artifacts (PLAN-*.md)
  mcp/             # servers.yml, manifest.json, README.md
  project.mcp.json # generated MCP manifest
```

`plans/*.md` is semantic content written only by the Orchestrator; `database/*.yml` is runtime state written by
the services. The former `workforce/` state root is gone (one-way legacy read fallback only).

---

## Commands

| Do This | Use This Command |
|---------|------------------|
| Open the Workforce Control Center | `sprintdesk.openWorkforce` |
| View workforce | `sprintdesk.viewWorkforce` |
| Add a person | `sprintdesk.addEmployee` |
| Create team | `sprintdesk.createTeam` |
| Assign to team / Set team lead | `sprintdesk.assignToTeam` / `sprintdesk.setTeamLead` |
| Set employee status / Remove employee | `sprintdesk.setEmployeeStatus` / `sprintdesk.removeEmployee` |
| Sync people from Git | `sprintdesk.syncPeopleFromGit` |
| Process queue | `sprintdesk.processQueue` |
| Cancel run | `sprintdesk.cancelRun` |
| Start MCP server | `sprintdesk.startMcp` |
| Refresh | `sprintdesk.refresh` |

The sidebar shows the **People & Workforce** and **History** sections; plan- and workforce-driven flows live in
the Control Center. The legacy `sprintdesk.*` settings in the extension manifest are retained for backward
compatibility but are not consumed by the v1.0 runtime — operational configuration lives under
`.SprintDesk/settings/`.

---

## Technical Features

### 🛠 System Integration
- File system management, Git integration (including checkpoint git-ref metadata), VS Code extension API
  utilization, workspace folder management, file watching and updates.

### 🔧 Configuration
- Data-driven configuration under `.SprintDesk/settings/` (queue, schedules, workflows), template
  customization, and metadata configuration.

### 🎨 UI/UX Features
- Sidebar tree navigation, Control Center webview, context-aware commands, quick actions, status icons and
  indicators, progress visualization.
