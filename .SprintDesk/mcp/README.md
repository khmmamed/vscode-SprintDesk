# SprintDesk MCP Server

Local MCP server (v1.1.0) for integrating SprintDesk with AI agents like Copilot, Claude, etc.

## Available Tools

The server exposes 43 tools across 15 groups.

### agent

- `sprintdesk_agentsList` — List available agents (from people/agents.yml)
- `sprintdesk_agentsGet` — Get a single agent by ID

### run

- `sprintdesk_runsCreate` — Create a new run record for a plan (queued; no autonomous execution)
- `sprintdesk_runsList` — List run records, optionally filtered by planId or status
- `sprintdesk_runsGet` — Get a run record by ID
- `sprintdesk_runsCancel` — Cancel a queued or running run (delegates transition to the queue service)
- `sprintdesk_runsUpdate` — Report worker completion for a running run (completed|failed; delegates final transition to the queue service)

### queue

- `sprintdesk_queueGet` — Read-only snapshot of the workforce queue: settings, capacity, queued/running runs, next claims and skip reasons for the next pass
- `sprintdesk_queueProcess` — Run one synchronous queue pass: claim + start eligible queued runs, then execute each via the worker boundary (headless/terminal/noop). No implicit auto-assignment.

### event

- `sprintdesk_eventsPublish` — Publish an event record
- `sprintdesk_eventsList` — List recent events, optionally filtered

### audit

- `sprintdesk_auditList` — List audit entries, optionally filtered by actor or target

### context

- `sprintdesk_projectContext` — Get a compact snapshot of the project: counts, statuses, active runs, recent events

### workforce

- `sprintdesk_skillsList` — List the skill catalog (workforce/skills.yml), including aliases used for matching
- `sprintdesk_skillsUpsert` — Add or update a skill in the catalog (matched by id; falls back to name)
- `sprintdesk_policyGet` — Get effective permissions for a role or an employee (RBAC matrix + allow/deny overrides)
- `sprintdesk_recommendEmployees` — Deterministically rank employees for a plan or classification type by skill coverage -> lower load -> idle -> name -> id
- `sprintdesk_activitySummary` — Overall workforce activity snapshot: employee/run/plan counts, queue settings, and the latest 20 events

### history

- `sprintdesk_getHistory` — Get change history for an item, or all recent history
- `sprintdesk_trackChange` — Record a change-history entry

### mcp

- `sprintdesk_mcpServersList` — List registered MCP servers
- `sprintdesk_mcpServersAdd` — Register an MCP server (stdio or http)
- `sprintdesk_mcpServersUpdate` — Update a registered MCP server
- `sprintdesk_mcpServersRemove` — Remove a registered MCP server
- `sprintdesk_mcpToolsList` — List tools exposed by an MCP server (requires mcp:list permission and mcp.<server>.list capability for the acting employee)
- `sprintdesk_mcpCheck` — Dry-run safety check for a future MCP tool call (capability + permission + server state)
- `sprintdesk_mcpCall` — Invoke a tool on an MCP server through the safety chain (agent capability + employee permission)

### approvals

- `sprintdesk_gatesGet` — Read the current approval gate modes (plan-classification, run-execution, config-change, deploy-authorization): auto or manual
- `sprintdesk_gatesSet` — Set an approval gate mode (requires approval:configure)
- `sprintdesk_approvalsList` — List approval requests by status (default pending)
- `sprintdesk_approvalsApprove` — Approve a pending approval request and perform its deferred operation (requires approval:review)
- `sprintdesk_approvalsReject` — Reject a pending approval request (requires approval:review)
- `sprintdesk_employeeConfigure` — Update an employee modelProfile/agentConfig/capabilities (deferred to approval queue when config-change gate is manual)

### input

- `sprintdesk_inputsList` — List all inputs (raw work requests flowing through the plan pipeline)
- `sprintdesk_inputsIngest` — Ingest a new raw input into the plan pipeline

### plan

- `sprintdesk_plansList` — List plans in the plan registry
- `sprintdesk_plansGet` — Get a plan by ID or code
- `sprintdesk_plansReplan` — Replan a failed or stale plan (creates a new cycle + queued run)

### checkpoint

- `sprintdesk_checkpointsList` — List checkpoints for a run or plan
- `sprintdesk_checkpointsApproveDeploy` — Approve a checkpoint deploy authorization (resolves pending deploy-authorization approval)
- `sprintdesk_checkpointsRejectDeploy` — Reject a checkpoint deploy authorization

### cycle

- `sprintdesk_cyclesList` — List execution cycles for a plan or input

### organizer

- `sprintdesk_organizerRun` — Run one organizer pass: classify inputs → create/update plans → queue runs

## Usage

AI agents can discover and use these tools through the MCP protocol when this extension is active.
