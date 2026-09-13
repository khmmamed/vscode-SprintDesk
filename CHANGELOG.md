# Change Log

All notable changes to the "vscode-SprintDesk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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