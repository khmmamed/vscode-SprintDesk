# vscode-SprintDesk

A Visual Studio Code extension for **plan-native autonomous workforce orchestration**. SprintDesk turns dropped
inputs into Plans, organizes and executes them through a policy-gated workforce runtime, and makes every step
reviewable. A **Plan is the only unit that can enter execution**.

---

## Features

### Plan-Native Work
- **Inputs** - Drop `inputs/*.md` (or use the Create Input form); the Orchestrator turns them into Plans
- **Plans** - `plans/PLAN-*.md` artifacts with a runtime registry tracking classification, dependencies,
  scheduling, execution, and lineage
- **Organizer** - re-classifies and prioritizes existing plans, detects dependencies, and selects the execution
  mode and agent without ever rewriting plan content
- **Cycles & Checkpoints** - each ingest opens a Cycle; a passing validation writes a Checkpoint and closes it
- **Deploy authorization** - checkpoints are deployed only after an explicit human decision

### Team Collaboration
- Add people (humans and AI agents) manually
- Automatically sync people from Git commit history
- Track all changes with the History view

### Workforce & Autonomous Work
SprintDesk ships a **workforce runtime**: a deterministic, policy-gated pipeline that maps
people → skills → tools → permissions → plans, with an LLM executing run work (ollama/openai). The whole
pipeline is operated from the **Workforce Control Center** (`sprintdesk.openWorkforce`). See
[`docs/current-features.md`](docs/current-features.md) for the full feature list and
[`docs/v1.0.0-proposal.md`](docs/v1.0.0-proposal.md) for the canonical architecture.

- **Control Center (v1.0)** — a single webview that operates the entire lifecycle with no YAML/CLI/MCP:
  `Input → Plan → Organize → Dispatch → Run → Finding → Validation → Checkpoint → Deploy`. Tabs for Employees,
  Plans, Inputs, Checkpoints, Cycles, Runs, Findings, Plan Classifications, Approvals, Schedules, Workflows,
  Event Rules, Execution Windows, and Activity, with a live event ticker, clickable cross navigation, and
  empty/loading/error states throughout.
- **People & workforce** — human/agent members with certified skills, RBAC roles, and lifecycle gates
  (skills/policy in `.SprintDesk/database/`; people in `.SprintDesk/people/`); agents are configured
  (provider/model/capabilities) from the UI
- **Plans → Runs → Queue → Worker** — a plan drives a `run`; queued runs are claimed by the queue
  (manual pass or event-driven) and executed by headless/terminal/noop/ollama workers; every state change
  flows through `startRun` / `finishRun` / `cancelRun`
- **LLM providers** — ollama/openai model profiles per employee (model output is *data today*, never authority)
- **MCP servers** — built-in `sprintdesk_*` toolset plus a capability-gated MCP client registry
- **Findings** — the agent's primary output: materialized from the `Findings:` section of completed runs into
  first-class persisted objects with severity/confidence and a review journey
- **Validation & approvals** — agents validate findings (`recommend-approve/reject/request-revision`, confidence,
  reason); humans decide; `auto`/`manual` approval gates for plan-classification, run-execution, config-change,
  and deploy (human-gated)
- **Retry policy** — `maxRunRetries`, `retryBackoffMs`, `runTimeoutMs`, failure classification and
  `availableAt` backoff gating
- **Scheduler & autonomy** — deterministic cron/interval scheduler (`plan` / `classify` / `organize` actions)
  with autonomy levels `0–3` (default `1`)
- **Execution Windows** — deliberate synchronous batches: `Human → Window → Workflow → Plan/Run → Queue →
  Worker → Finding → Validation → Decision`, persisted and reviewable after the fact
- **Event Rules** — `Event → Rule → Workflow → Plan/Run` async automation from the existing event stream,
  idempotent and re-entrancy-safe
- **Workflow DSL** — declarative `plan` / `loop` / `tool` / `condition` workflows; a `plan` step materializes a
  Plan and a queued run (`.SprintDesk/settings/workflows.yml`)

### Quick Access
- Open the Workforce Control Center from the command palette or the sidebar
- Quick commands from the command palette

### Multi-Project Support
- Work on multiple projects or repositories
- Switch between projects easily

---

## Getting Started

1. Open VS Code and click the SprintDesk icon in the sidebar
2. Expand the **People** section to manage humans, agents, and teams
3. Use the other sections — **Requests**, **Plans**, **Findings**, **Approvals**, **Schedules**, **Workflows**,
   **Activity**, and **History** — or open the Workforce Control Center for bulk operations

### Commands

| Do This | Use This Command |
|---------|------------------|
| Open the Workforce Control Center | `sprintdesk.openWorkforce` |
| View workforce | `sprintdesk.viewWorkforce` |
| Add a person | `sprintdesk.addEmployee` |
| Create team | `sprintdesk.createTeam` |
| Sync people from Git | `sprintdesk.syncPeopleFromGit` |
| Process queue | `sprintdesk.processQueue` |
| Start MCP server | `sprintdesk.startMcp` |
| Refresh | `sprintdesk.refresh` |

---

## Settings

Operational configuration is **data-driven** and lives in the workspace under `.SprintDesk/settings/`
(`queue.yml`, `schedules.yml`, `workflows.yml`, `credentials.secret.json`). Approval gates
(`run-execution`, `config-change`, `plan-classification`, `deploy`) are configured in `queue.yml`.

There are no extension settings: the v1.0 manifest declares no `sprintdesk.*` configuration properties.

---

## How to Contribute

1. Fork the repository on GitHub
2. Create a branch for your feature:
   ```sh
   git checkout -b feature/my-feature
   ```
3. Make your changes and commit them
4. Push to your fork and open a Pull Request
5. Participate in code reviews

**Guidelines:**
- Follow the existing code style
- Write clear commit messages
- Test your changes before submitting

---

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

```
Copyright (C) 2024 khmamed

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```