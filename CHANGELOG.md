# Change Log

All notable changes to the "vscode-SprintDesk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2026-09-18

**Plan-native sidebar Control Center (Slice T).** The sidebar grows from two sections to eleven, exposing the
v1.0 runtime directly in the Activity Bar. Every categorized view is a **view over Plan-centric state** — it
resolves canonical Plan IDs and introduces no second work model and no duplicate Plan storage.

### v1.0 Slice W — Plan Refinement Pipeline

- **One Request, one refined Plan.** Request-born plans now flow through a staged pipeline on each intake pass:
  `reader → planner → classifier → organizer → scheduler`, terminating at `ready` (ready for the gated
  Dispatcher — execution itself still requires `queueSettings.enabled`). `runIntakePass` ends by calling
  `runPendingPipelines()`.
- **Each stage owns its own section.** Classifier writes `## Classification`, Organizer writes `## Breakdown` /
  `## Dependencies` / `## Assignment`, Scheduler writes `## Execution Plan`; the Reader/Planner own
  Objective/Implementation. Sections are optional and empty stages leave the artifact byte-identical.
- **Idempotent and convergent.** `Plan.pipeline` (registry-authoritative, mirrored in front-matter) records the
  stage and a per-stage history; each stage hashes its own inputs, so a steady-state pass rewrites nothing and
  emits nothing. Editing a plan re-runs only the affected downstream stages.
- **Hybrid refinement.** A stage runs the assigned Orchestrator-role member's model when one resolves
  (`modelProfile`/`modelId`), otherwise it falls back to the deterministic result; scheduling stays
  registry-authoritative. Synthetic (workflow/schedule) and proposal-derived plans are excluded.
- **Observability.** New `plan.pipeline.stage` (with `stage`/`source`/`memberId`) and terminal `plan.ready` events;
  the Control Center Plans rows show the current stage.
- **Fix.** Plain-markdown Requests (no front-matter) are now read from their heading/paragraph, so manually
  dropped files produce Plans; intake failures are surfaced as `intake.failed` instead of being swallowed.

### v1.0 Slice T — Plan-native sidebar Control Center

- **Eleven sections.** `People`, `MCP`, `Tools`, `Requests`, `Plans`, `Findings`, `Approvals`, `Schedules`,
  `Workflows`, `Activity`, and `History` replace the former `People & Workforce` + `History` pair; the workflow
  **nav rows are promoted to top-level sections** and no longer duplicated under Workforce.
- **Categorized Views over Plans.** Findings resolve `finding.planId` into a canonical plan group (with an
  `Unlinked` bucket); Approvals group every plan- or run-linked approval by canonical Plan; Schedules resolve
  plan links from `ScheduleRecord`; Workflows resolve the existing indirect links in `EventRuleTrigger.createdPlanIds`
  and `ExecutionWindow.{workflowIds,planIds}`. No `findings/Plans.yml`-style parallel Plan storage exists.
- **Requests.** `inputs/*.md` (`InputStore`) surface as **Requests**, with open, create, and an
  Organizer pass (`sprintdesk.runOrganizer` → `triggerOrganizer`, never a direct plan write).
- **Plans.** Canonical `PlanStore` rows with context actions backed by verified services only: open
  (`planService.resolvePlanFile`), enqueue / cancel / requeue / reassign (`plan/dispatcher.ts`).
- **Approvals.** Approve / Reject resolve through `services/workforce/approvals.ts` (`approval:review`).
- **Tools catalog.** New minimal `ToolStore` (`.SprintDesk/database/tools.yml`, mirroring `SkillStore`) with five
  seeded tools; optional `Employee.mcps` / `Employee.tools` capability refs let agents be scoped to registered MCP
  servers and tools.
- **Live Activity.** The `Activity` section renders `EventStore` and refreshes on a debounced `subscribeEvents`
  subscription; `History` remains the existing git/audit provider.
- **Manifest.** New `sprintdesk.*` commands and `view/title` + `view/item/context` menu contributions; no
  `contributes.configuration` is added.

### v1.0 Slice V — Model Catalog

- **Models section.** A new `Models` sidebar section lists the `ModelStore` catalog
  (`.SprintDesk/database/models.yml`, mirroring the `ToolStore` pattern), showing each model's provider, model id,
  base URL, and any assigned agents.
- **Register models once, assign to agents.** **Add Model** / **Edit Model** / **Remove Model** register an entry
  (provider, model id, base URL, API-key secret ref, temperature/max tokens). Assignment works in both directions:
  **Assign Model to Agent** from a model row (picks one or more agents) and **Select Agent Model** from an agent row
  (picks one model, or Unassigned).
- **Assignment is gated and audited.** Assignment writes a snapshot into `Employee.modelProfile` through
  `applyConfigChange`, so it honors the existing `config-change` approval gate and audit trail; the additive
  `Employee.modelId` records the catalog origin and lets the Models tree show which agents use a model. Clearing a
  model uses the new `clearModel` change. No `contributes.configuration` is added.

### v1.0 Slice U — Orchestrator Team & Automatic Request Intake

- **Automatic intake.** Dropping a `.SprintDesk/inputs/*.md` Request now produces its Plan with no manual step:
  one pass discovers the file → ingests it → runs the Orchestrator (reader → classifier → planner) → runs the
  Organizer → records the scheduling decision. Execution stays gated by `queueSettings.enabled` (default off).
- **Three convergent discovery paths.** An `input.created` event trigger, a `FileSystemWatcher` on
  `.SprintDesk/inputs/*.md`, and interval reconciliation all funnel into the same idempotent pass, so no
  duplicate Plans are created (dedup by file hash and normalized objective — one Request → one Plan lineage).
- **Orchestrator team.** A seeded, idempotent `Orchestrator` team owns eight stage roles: `reader`,
  `classifier`, `planner`, `organizer`, `scheduler`, `validator`, `tester`, `human-sync`. Roles are
  assignment/identity only — an unassigned role falls back to the existing deterministic service.
  `People → Teams → Orchestrator` lists the roles with **Assign Orchestration Role** / **Clear Orchestration
  Role** actions.
- **Observability.** Stage events (`orchestration.reader.completed`, `.classifier.completed`,
  `.planner.completed`, `.organizer.completed`, `.scheduler.evaluated`) join `input.created` / `plan.created`
  in Activity, under the `intake` source, and carry the assigned member id when a role is filled.

## [1.0.1] - 2026-09-17

**Final integrity audit (Slice S).** No behavior change: the last dead legacy PM type was removed and the
shipped v1.0.0 surface was re-verified end to end (typecheck, lint, tests, packages).

### v1.0 Slice S — Final integrity audit

- **Dead domain type removed.** The `Epic` interface — the last surviving legacy PM type, referenced by no
  consumer — is deleted from `src/data/types.ts`; `docsConsistency.test.ts` now guards against its return.
- **Full-surface audit (no behavior change).** Plan/Input/Run/Checkpoint lifecycle, the Organizer → Dispatcher
  → Worker → Validator → Checkpoint wiring, recovery/replan idempotence, always-manual deploy authorization,
  event + scheduler behavior, the `database/` storage boundary, the MCP registry and its generated artifacts,
  the CLI entrypoints and extension activation, the workflow DSL, the agent command contract, and the absence
  of retired Task/Epic/Backlog/Sprint runtime concepts were all re-verified green (typecheck, lint, tests,
  packages).

## [1.0.0] - 2026-09-17

**Plan-native replatform (slices A–R).** In 1.0.0 a **Plan is the only unit that can enter execution** — there
is no Task compatibility layer underneath it. The legacy Task/Epic/Backlog/Sprint project-management surface is
removed from the active runtime, and all runtime state lives under `.SprintDesk/database/`.

- **Two control layers.** An **Orchestrator** turns `inputs/*.md` into semantic `plans/PLAN-*.md` artifacts; an
  **Organizer** reconciles the plan registry (classification, dependencies, scheduling, execution, assignment)
  without ever rewriting plan content.
- **One execution path.** Organizer → **Dispatcher** → `queueService.createRun(planId, agentId)` → Worker →
  Findings → Validator → **Checkpoint** → deploy authorization. Output is data, never authority.
- **Storage boundary.** `.SprintDesk/database/` holds runtime state; `.SprintDesk/settings/` configuration;
  `.SprintDesk/people/` identity; `.SprintDesk/inputs/` + `.SprintDesk/plans/` artifacts. The `workforce/`
  state root is gone.
- **No Task→Plan migration utility.** v1.0 starts from the Plan-native storage model and no supported legacy
  workspace format remains to import (Slice O). The residual dead `Epic` interface was removed in 1.0.1.

### v1.0 Slice A — Plan domain, stores & storage layout

- **Plan/Input/Cycle/Checkpoint domain:** new `Plan`, `PlanOrganizationStatus`, six-axis
  `PlanClassificationAxis`, `PlanScheduling`, `PlanExecution`, `PlanValidation`, `PlanLineage`, `PlansData`,
  plus `InputRecord`/`InputsData`, `Cycle`/`CyclesData`, `Checkpoint`/`CheckpointsData` types.
- **New `database/` stores:** `PlanStore` (`plans.yml`), `InputStore` (`inputs.yml`), `CycleStore`
  (`cycles.yml`), `CheckpointStore` (`checkpoints.yml`); `RunStore` relocated from `data/runs.yml` to
  `database/executions.yml` (internal key stays `runs`); `EventStore`/`AuditStore` relocated to `database/`.
- **Plan markdown round-trip:** `planService.writePlanMd` / `readPlanMd` using `gray-matter`; front-matter
  carries `id`/`version`/`lineage`, the body holds Objective/Implementation/Acceptance Criteria/Constraints.
  The `.md` is only ever written by the Orchestrator content path — no registry mirror.

### v1.0 Slice B — Orchestrator (inputs → plans)

- **`orchestrator.ts`:** `listInputs()` discovers `inputs/*.md` not yet registered (mtime + content-hash dedup);
  `ingestInput()` creates an `InputRecord` and opens a `Cycle`; `orchestrate()` decomposes an input
  deterministically (front-matter/defaults) or via the LLM classifier calling convention.
- **Bounded and idempotent:** each generated unit becomes a `plans/PLAN-####.md` artifact + seeded
  `classification.original` in the registry; capped by `maxPlansPerPass` (default 5) and deduped against
  existing plans by normalized objective. Emits `plan.created`, `input.planned`, `cycle.opened`; never writes
  `classification.current`.

### v1.0 Slice C — Organizer core (reconciliation)

- **`plan/organizer.ts` + `runOrganizerPass()`:** reconciles each non-terminal plan — classification
  (`original → current` with `classifiedBy` + reason), dependency detection (`dependsOn`), runnability,
  `executionMode` selection, and agent selection via `rankEmployees` against plan dimensions.
- **Custody rule:** writes only `database/plans.yml` (`organization.*`, `classification.current`,
  `scheduling.*`, `execution.*`) and **never** rewrites plan content. A fundamentally wrong plan emits
  `plan.replanning.requested` instead of being silently rewritten.
- **Convergent emission:** a no-change pass emits nothing; `organizer.pass.completed` and decision-change
  `plan.execution.*` events only.

### v1.0 Slice D — Plan execution identity (critical seam)

- **`Run.planId` required, `Run.taskId` removed** (the Run key stays `runs` in `database/executions.yml`);
  `queueService.createRun(planId, agentId)` derives agent/workload/status from the plan registry.
- **Queue/worker/findings are plan-native:** `processQueue` skip reasons `plan-not-found`/`plan-not-runnable`;
  the worker request drives `plan.title`/`plan.path`; findings link to `planId`. The task-based test fixtures
  were rewritten atomically in the same slice.

### v1.0 Slice E — Dispatcher + execution events

- **`plan/dispatcher.ts`:** enqueues a plan whose registry state is organized ∧ scheduled-ready ∧
  execution-eligible via `queueService.createRun`, emitting `plan.execution.requested`; handles `delayed`
  (scheduled mode), `reassigned`, `cancelled`, and `requeued`.
- **New event types:** `plan.execution.requested|delayed|reassigned|cancelled|requeued`,
  `plan.replanning.requested`, `organizer.trigger`, `organizer.pass.completed`, `plan.created`,
  `input.planned`, `cycle.opened` — wired into the event-rule matcher surface (additive).

### v1.0 Slice F — Organizer engine wiring (scheduler → production)

- **`ScheduleAction = 'plan' | 'classify' | 'organize'`:** `runSchedulerPass` drives `runOrganizerPass()` for
  `organize` schedules; the legacy `task` schedule action is replaced by `plan`.
- **The scheduler driver is now live:** activation installs an interval driver honoring
  `queueSettings.enabled` / `pollIntervalMs` (default `enabled: false`, so nothing runs until opted in); a
  headless `npm run scheduler` CLI mirrors `cli/worker.ts`.
- **Manual force-run** via the Control Center, `sprintdesk_organizerRun`, and the CLI flag; agent idle/offline
  and `execution.completed`/`dependency.completed` raise `organizer.trigger` over the existing event stream.

### v1.0 Slice G — Recovery, Checkpoint & Deploy authorization

- **Recovery (`plan/recovery.ts`):** `classifyFailure`/`decideRecovery`/`recoverFailure` turn a failed run or
  validator revision into either a backoff `plan.requeued` or a `plan.replanning.requested` → new
  `inputs/*.md` record. The Organizer never writes content; `cycle.outcome` is set on escalation.
- **Checkpoint (`plan/checkpointService.ts`):** a validator pass writes `database/checkpoints.yml`
  (`CHK-####`, planId, artifacts, status `ready`), closes the `Cycle`, and emits `checkpoint.created` /
  `cycle.closed`.
- **Deploy authorization:** the new `deploy` gate (default `manual`) plus `plan:deploy` permission; approval
  flows through the existing resolver (`op: 'authorize-deploy'`). `sprintdesk_checkpointsApproveDeploy` /
  `RejectDeploy` and Control Center actions emit `deploy.authorized|rejected` and `checkpoint.deployed`.

### v1.0 Slice H — Control Center, MCP & command rework

- **Plan-native Control Center:** the workforce control center now exposes Plans / Inputs / Checkpoints /
  Cycles tabs in place of the legacy Tasks tab; Proposals becomes Plan-classification review backed by the
  `plan-classification` gate; the create-input form and drop-zone hints replace the create-task form. Runs /
  Queue / Findings / Approvals / Schedules / Workflows / Event Rules / Windows / Activity stay, with a plan
  reference added to findings.
- **MCP rework:** task/epic/sprint/backlog/move tool groups are gone; `sprintdesk_inputsList` / `inputsIngest`,
  `plansList` / `plansReplan` / `plansGet`, `organizerRun`, `checkpointsList` / `checkpointsApproveDeploy` /
  `checkpointsRejectDeploy`, and `cyclesList` replace them. Manifest and README are rebuilt from the registry.
- **Legacy command & UI removal (v1.0 Slice H):** removed the 28 legacy contributed commands
  (`addTask`…`createBacklogFromRepo`, history/settings legacy items), the Tasks / Backlogs / Epics / Sprints /
  Repositories tree providers, the legacy `App.tsx` / TasksTable / EpicsList webview surfaces, and the dead
  `MigrationService`. The sidebar now shows People & Workforce + History sections only; the Control Center
  handles the plan- and workforce-driven flows.

### v1.0 Slice I — Legacy data layer removal + plan-native consumers

- **Removed the legacy PM data layer:** the `Task`/`Backlog`/`Sprint` types and their services
  (`taskService`, `epicService`, `backlogService`, `sprintService`), the legacy `DataService` markdown writers,
  and the remaining task-centric consumers — migrating queue/worker/workflow/findings/window/classification to
  the plan-native stores (~2,600 lines removed across 43 files).
- **Workflow `task` steps now materialize Plans** (the `taskType` enum is mapped through
  `legacyTaskKindToPlanCategory`); the DSL key itself is unchanged (superseded by Slice M).
- **Tracked residuals (not removed in this slice):** the dead `Epic` interface and the legacy
  Epic/Backlog/Sprint constant strings were left as cleanup debt (the constants removed in Slice R, the `Epic`
  interface removed in Slice S); the migration CLI was not shipped and is resolved as **not required** in
  Slice O.

### v1.0 Slice J — Validator → checkpoint → deploy wiring

- **`plan/validator.ts`:** `deriveValidationRecord` / `validateCompletedRun` turn a completed run into a
  `PlanValidation` record; `installValidator()` auto-validates completed runs and, on a passing validation,
  creates a checkpoint and closes the cycle. `requestDeployForCheckpoint` drives the `authorize-deploy`
  approval under `plan:deploy`.
- **MCP parity:** `sprintdesk_checkpointsApproveDeploy` / `RejectDeploy` resolve the deploy decision through
  the same checkpoint service the Control Center uses; the full pipeline is covered by
  `test/smoke/validationPipeline.test.ts`.

### v1.0 Slice K — Storage boundary: runtime state under `database/`

- **Final storage boundary:** every runtime state file lives under `.SprintDesk/database/` —
  `inputs/plans/executions/checkpoints/cycles/events/audit/findings/approvals/policy/skills/eventRules/
  classification/executionWindows`. `.SprintDesk/settings/` holds configuration (`queue.yml`, `schedules.yml`,
  `workflows.yml`, `credentials.secret.json`), `.SprintDesk/people/` holds identity, and the `workforce/` state
  root is removed.
- **One-way legacy read fallback:** relocated stores (`FindingStore`, `ApprovalStore`, `EventRuleStore`,
  `ExecutionWindowStore`, `SkillStore`, `ProposalStore`, `PolicyStore`, credentials) still *read* a legacy
  `workforce/<file>` record and migrate it on the next write; new writes always target the new path.
- **Invariant coverage:** `test/smoke/storageBoundary.test.ts` proves no store creates `workforce/` and that
  each legacy read/write round-trips into `database/`.

### v1.0 Slice L — Release & documentation integrity

- **Release metadata:** `package.json` bumped to `1.0.0` with the Plan-native description; the `[1.0.0]`
  CHANGELOG section records slices A–K (later A–M), and the v0.12 slice history is preserved under a
  pre-release-line heading rather than dropped.
- **Docs rewritten to current behavior:** `docs/current-features.md` and `README.md` describe the Plan-native
  lifecycle, the `database/` storage boundary and the current commands; the v0.12 proposals carry a
  historical-status note and `docs/v1.0.0-proposal.md` is marked implemented with section 10 as a
  pre-implementation grounding snapshot.
- **Guardrail:** `test/unit/docsConsistency.test.ts` asserts the package version matches the newest CHANGELOG
  heading, the slices are documented, and the current docs stay free of legacy storage paths.

### v1.0 Slice M — Workflow DSL: `plan`-native step contract

- **The DSL step is plan-native.** `WorkflowStepType` is now `plan | loop | tool | condition`; `WorkflowTaskStep`
  became `WorkflowPlanStep` with `type: 'plan'`, `category: PlanCategory` and `priority: PlanPriority`. The legacy
  `taskType: ProposalType` enum, the `backlog` hint and the `legacyTaskKindToPlanCategory` hop inside the engine are
  gone — a `plan` step materializes a Plan directly (`{ planId, runId }`). Loops, tools and conditions are untouched.
- **No compatibility shim.** `.SprintDesk/settings/workflows.yml` is user-authored configuration, so the old `task`
  step / `taskType` keys are not read; workflows are authored with `type: 'plan'` and `category`.
- **Resolver guarantees unchanged:** `plan` steps still emit `run.queued` as source `workflow`, never bypass
  `QueueService`, and never let tool/LLM output drive control flow.

### v1.0 Slice N — Dead configuration cleanup

- **Removed the legacy `sprintdesk.*` settings.** All 18 unreferenced `contributes.configuration` properties
  are gone from the manifest (project/epic/task/backlog/sprint prefixes, start numbers, padding, markdown
  filename patterns, `defaultBacklog`, `defaultStatus`, `defaultPriority`, `showIds`), together with the dead
  `IHost.getConfig` accessor and the `NodeHost` settings map that only served them. There are no extension
  settings in v1.0 — operational configuration is data-driven under `.SprintDesk/settings/`.
- **Guardrail:** `docsConsistency.test.ts` fails if any `sprintdesk.*` configuration property reappears.

### v1.0 Slice O — Migration-tool decision (Task→Plan not required)

- **No Task→Plan migration utility ships.** The previously planned opt-in one-shot archive importer is
  removed from the plan: it would have read legacy `tasks.yml`, but the legacy project-management data layer
  and every reader for it were removed in Slice I, so no supported legacy workspace format remains.
- **Architecture note:** v1.0 starts from the Plan-native storage model (`.SprintDesk/plans/PLAN-*.md` +
  `.SprintDesk/database/plans.yml`); legacy workspaces keep their history in Git and are not auto-imported.

### v1.0 Slice P — Task-vocabulary cleanup in the active surface

- **Proposal domain types renamed.** `TaskProposal`/`TaskProposalStatus`/`TaskProposalTaskPayload`/
  `TaskProposalEdit` became `Proposal`/`ProposalStatus`/`ProposalPayload`/`ProposalEdit`; the persisted
  `ProposalsData.proposals` entries and the capability/classification services follow.
- **Classification vocabulary de-tasked.** `Finding.suggestedTaskType` → `suggestedType`; the
  `classification.recommend` audit detail `taskType` → `type`; `TASK_TYPES`/`TASK_PRIORITIES` →
  `PROPOSAL_TYPES`/`PROPOSAL_PRIORITIES`; `LegacyTaskKind`/`legacyTaskKindToPlanCategory` →
  `LegacyProposalKind`/`legacyProposalKindToPlanCategory`; the `TaskType` store alias is gone.
- **Events renamed.** `task.proposal.created|rejected|requeued|edited` → `proposal.created|rejected|requeued|edited`.
- **Capability input renamed.** `SkillTaskSpec` → `SkillSpec` and `skillsForTask` → `skillsFor`; the
  `sprintdesk_capabilityRecommend` MCP response key changes from `task` to `spec`.
- **Dead Task strings removed.** The orphaned `task:assign`/`task:claim` policy permissions and the
  unreferenced `task.assigned` control-center event label are deleted. Schedule records fall back to the
  `plan` action (not `task`), and the schedules tab renders the record's real action.

### v1.0 Slice Q — Agent command contract: plan-native placeholders

- **Custom-command placeholders renamed.** `{task_path}`/`{task_dir}`/`{task_file}` became
  `{plan_path}`/`{plan_dir}`/`{plan_file}`; `{description}` is unchanged. The generated command line resolves
  to the same executable, arguments and plan artifact path — only the placeholder names differ.
- **Prompt terminology.** The `opencode`/`ollama`/custom prompts now read `Plan: <title>` instead of
  `Task: <title>`. The `claude-code` `--task` flag is a Claude Code CLI contract, not SprintDesk vocabulary,
  and is unchanged.
- **Contract documented.** `AgentConfig.command` documents the supported placeholders, and the MCP
  `agentConfig` description states the real shape instead of the never-implemented `workingDir`/`promptTemplate`.
- **Coverage:** new `test/smoke/agentCommand.test.ts` pins the exact `{ command, args }` for every `tool`.
- **No compatibility shim.** `.SprintDesk/settings/agents.yml` is user-authored configuration (same rule as
  Slice M), so the old `{task_*}` placeholders are not read.

### v1.0 Slice R — Legacy artifact & hardening cleanup

- **Command renamed to its real behavior.** `sprintdesk.createTaskForEmployee` (the contributed command and
  the `employeeAgent` context-menu entry) is now `sprintdesk.createInputForEmployee` ("Create Input for
  Agent"); it opens the Control Center create-input tab for the selected agent, exactly as before.
- **Dead legacy constants removed.** `src/utils/constant.ts` is reduced to the live `PROJECT_CONSTANTS`
  (`.SprintDesk`/`data`) and `WEBVIEW_CONSTANTS`. The unreferenced `COMMON_EMOJI`/`STATUS_EMOJI`/
  `PRIORITY_EMOJI`/`TASK_CONSTANTS`/`EPIC_CONSTANTS`/`BACKLOG_CONSTANTS`/`SPRINT_CONSTANTS`/`UI_CONSTANTS`/
  `SAMPLE_CONSTANTS`/`GIT_CONSTANTS` groups — including `TASK_LINK` and the `# 🧩 Task:` template — are gone.
- **Global legacy namespace deleted.** `src/types/global.d.ts` (`SprintDesk.*` task/epic/backlog/sprint
  table-row types) existed only for those dead constants and is removed with them.
- **Dead workspace artifacts removed.** `.SprintDesk/data/{tasks,backlogs,epics,sprints}.yml` and
  `.SprintDesk/Tasks/` are deleted; no code path read them (runtime state lives under `database/`).
- **MCP artifacts can no longer drift.** `buildMcpReadme()` is generated from the same `TOOL_GROUPS` as
  `buildMcpManifest()`, and activation rewrites `.SprintDesk/mcp/README.md` on every load instead of seeding
  it once; the committed README and manifest are regenerated (43 tools across 15 groups). The old hardcoded,
  task-era README is gone.
- **Recovery idempotence hardened.** A replan is deduped on the persisted input's durable identity
  (`source.id === runId`, or the deterministic `inputs/replan-<runId>.md` name) instead of its transient
  `status === 'new'`, so an already-consumed replan can no longer be requested twice. The replan objective
  resolves the plan's real title through `planService.planTitleFor` rather than an id-only helper.

## v0.12 — pre-release development line (shipped in 1.0.0)

### v0.12 Slice A — Approvals resolve (Approve / Reject)

- **Inline approval decisions in the Control Center:** pending approval cards now carry Approve / Reject
  actions that call the same `approvals.approve` / `approvals.reject` path the MCP tools use, so every
  deferred operation (task assignment, run start, config change) applies identically from the UI.
- **Live status without a full reload:** a resolve round-trip (`WORKFORCE_RESOLVE_APPROVAL` + `APPROVAL_UPDATED`)
  flips the card to its decided state, records the decider when an actor is provided, and refreshes the pending
  approval count via the snapshot push.
- **MCP parity:** a missing or already-resolved approval surfaces the same "No pending approval found" error
  as `sprintdesk_approvalsApprove` / `sprintdesk_approvalsReject`; failures never clobber the panel state.

### v0.12 Slice B — Tasks edit & delete

- **Inline task editing from the Tasks tab:** Edit opens a title / status / priority / agent form backed by
  `taskService.updateTask`, restricted to the field set the existing DTO exposes so no unsupported `Task` fields
  can be written from the UI; invalid status/priority values are rejected before the command boundary.
- **Two-click delete with confirmation:** Delete becomes Confirm delete in a single click; the second click
  posts `WORKFORCE_DELETE_TASK` and the task disappears from the panel on the next snapshot.
- **Live card update:** successful edit/delete push a targeted `TASK_UPDATED` / `WORKFORCE_RESPONSE` payload
  that patches the card in place without a full list reload.

### v0.12 Slice C — Autonomous classification (deterministic)

- **Findings → task proposals:** pending findings that carry `suggestedTaskType` / `suggestedWorkflow` /
  `suggestedPriority` now produce one `TaskProposal` each (persisted to `.SprintDesk/workforce/classification.yml`),
  validated against the real `Task` enums — output is data, never authority.
- **Idempotent and bounded:** a finding is classified at most once; proposals are deduped against open tasks by
  normalized title; each pass respects `maxProposalsPerPass` (default 5) with the highest-severity findings first.
- **Gated apply:** auto-apply happens under `classification:apply` when the new `task-proposal` approval gate is
  `auto`; a `manual` gate routes through the existing approvals queue as a `task-proposal` approval that applies
  on Approve and leaves everything untouched on Reject.
- **Observable failures:** invalid suggestions and permission denials become `failed` proposals with a reason —
  never an implicit task and never a silence drop.

### v0.12 Slice D — Autonomous classification (LLM + review)

- **LLM classifier for findings without suggestions:** `worker/classifier.ts` turns a pending finding into a
  `TaskProposal` via the configured model profile (`classifyFinding`), normalizing the model's JSON against the
  real enums; failures (unparseable output or a throwing provider) become `failed` proposals with a reason — the
  whole pass never throws.
- **Ollama-first pass:** `runClassificationPass` now drives the LLM for findings that lack deterministic
  suggestions whenever the queue worker mode is `ollama` (or `classifyWithLlm` is requested); deterministic
  suggestions still short-circuit the model entirely.
- **Control Center trigger:** a **Classify Findings** button runs a pass from the Runs tab and reports
  scanned / proposed / applied / approval-requested / failed / duplicates; the newest classification proposals
  appear as a summary line so review stays gate-driven.

### v0.12 Slice E — Classification proposals review

- **Proposals tab:** a dedicated Control Center tab lists classification proposals newest-first with
  status (pending / applied / duplicate / failed / rejected), type, priority, workflow, confidence, and the
  failure reason on non-pending rows; a `Proposals N` stat chip mirrors the Approvals chip.
- **Review actions on pending proposals:** **Apply as Task** routes through the existing
  `classification:apply`-gated `applyProposal` (idempotent — an applied proposal is never double-created), and
  **Reject** marks the proposal `rejected` under the `classification:review` permission (`lead` / `reviewer` /
  `human`, never a plain `agent`), never creating a task and leaving the finding pending.
- **Live feedback:** apply/reject post a targeted `PROPOSAL_UPDATED` patch that updates the card in place plus
  a `WORKFORCE_RESPONSE` summary; denials surface a specific permission error instead of silently failing.

### v0.12 Slice F — Scheduler-driven classification passes

- **Scheduled classification:** a schedule can now declare `action: classify` (additive, `task` remains the
  default) so a time-based occurrence fires the existing deterministic → LLM classification pipeline instead
  of materializing a task. The scheduler triggers `runClassificationPass` — it never duplicates classification
  logic — and surfaces the pass summary in the fired result plus a `classification.pass` event.
- **The same guardrails apply:** scheduled passes respect `maxProposalsPerPass`, honor the `task-proposal`
  approval gate (`auto` applies straight through, `manual` routes every proposal to the approvals queue), and
  reuse `createProposal`/`applyProposal` dedup so a finding can never produce two proposals or tasks.
- **Overlap-safe:** a fire records the occurrence via the same `lastOccurrenceKey` bookkeeping as task
  schedules, so back-to-back passes at the same `now` are skipped and re-runs over the same findings are no-ops.
- **Surface:** the Schedules tab shows the schedule action (`task` / `classify`) so classify schedules are
  distinguishable at a glance.

### v0.12 Slice G — Proposal editing before Apply

- **Edit proposed task payloads:** a reviewer can adjust a `pending` proposal's title, type, priority, or
  workflow before Apply; the proposal stays `pending` while editing and Apply creates the task from the latest
  values. Original classification evidence (confidence, original title/type/priority/workflow) is preserved in
  an append-only `edits[]` history on the proposal so every edit is traceable.
- **Scoped and audited:** editing only touches the proposed task payload — the source finding, classification
  confidence, proposal status, and approval state are never changed. Every successful edit emits
  `task.proposal.edited` and audits `classification.edit` with before/after details. Invalid edits (empty title,
  unknown type or priority) throw a specific error and persist nothing.
- **Surface:** pending proposal cards in the Proposals tab carry an **Edit** button that opens an inline
  title/type/priority/workflow form with Save + Cancel; `edited N×` chips appear on proposals that have been
  edited; the extension exposes `editedAt`/`editCount` in the DTO.

### v0.12 Slice H — Requeue rejected proposals

- **Requeue rejected proposals:** a reviewer can explicitly revive a `rejected` proposal back to `pending` via
  **Requeue** so it can be applied as-is, edited, or rejected again — without re-running the classification
  pipeline. Rejection remains terminal by default; nothing auto-revives a rejected proposal.
- **Scoped and audited:** requeue is a pure status transition (`rejected → pending`, `reason` cleared) that
  never touches the source finding, classification evidence, approval queue, or scheduler. Every requeue emits
  `task.proposal.requeued` and audits `classification.requeue` (`targetType: proposal`) with `proposalId` and
  `actorId`.
- **Surface:** rejected proposal cards in the Proposals tab carry a **Requeue** button that immediately posts
  `WORKFORCE_REQUEUE_PROPOSAL`; the extension exposes `requeuedAt` in the DTO. No automatic pass is triggered —
  fresh classification requires an explicit manual classify run.

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