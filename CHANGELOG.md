# Change Log

All notable changes to the "vscode-async-postmessaging" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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

## [0.3.8] - 2025-11-06

- update task and add repo provider
- update task
- fix drop errors
- fix epic drags
- version bump to 0.3.8

## [released]

Add webview type to epics view and implement EpicsTree component
sprints name patterns
show task of backlogs sprints
humanized tasks names and open them when clicked
upcoming changes
change status in sprint files
open sprint file calendar should be fix it
show task status in sprint sidebar
fix: sprint name