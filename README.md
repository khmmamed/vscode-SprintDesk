# vscode-SprintDesk

A productivity extension for managing sprints, tasks, epics, backlogs, and teams directly within Visual Studio Code. SprintDesk helps you organize your agile development workflow right in your editor.

---

## Features

### Organize Your Work
- **Tasks** - Create and track individual tasks with automatic IDs
- **Epics** - Group related tasks together
- **Backlogs** - Organize upcoming work into categories like features, bugs, or improvements
- **Sprints** - Plan and manage active development cycles

### Work Your Way
- Drag and drop tasks between sprints, epics, and backlogs
- Set task status: waiting, in progress, under review, or complete
- Set priority: low, medium, high, or critical
- Visual sprint calendar to plan your sprint

### Team Collaboration
- Add team members manually
- Automatically sync team from Git commit history
- Add AI agents to help with tasks
- Track all changes with history view

### Workforce & Autonomous Work
SprintDesk ships a **workforce runtime**: a deterministic, policy-gated pipeline that maps
employees → skills → tools → permissions → tasks, with an LLM executing run work (ollama/openai). The whole
pipeline is operated from the **Workforce Control Center** (`sprintdesk.openWorkforce`). See
[`docs/v0.9-workforce-guide.md`](docs/v0.9-workforce-guide.md) for the runtime architecture and
[`docs/v0.11-upcomming.md`](docs/v0.11-upcomming.md) for the product model.

- **Control Center (v0.11)** — a single webview that operates the entire lifecycle with no YAML/CLI/MCP:
  `Human / Schedule / Event Rule → Workflow → Execution Window / Run → Queue → Worker → Finding → Agent
  Validation → Human Approval → Activity`. Default **Runs** tab with live event ticker, clickable cross
  navigation (Run ↔ Finding ↔ Window ↔ Workflow ↔ Rule ↔ Task ↔ Agent), and empty/loading/error states
  throughout.
- **Employees & workforce** — human/agent members with certified skills, RBAC roles, and lifecycle gates
  (`.SprintDesk/workforce/*.yml`); agents are configured (provider/model/capabilities) from the UI
- **Tasks → Runs → Queue → Worker** — a task drives a `run`; queued runs are claimed by the queue
  (manual pass or event-driven) and executed by headless/terminal/noop/ollama workers; every state change
  flows through `startRun` / `finishRun` / `cancelRun`
- **LLM providers** — ollama/openai model profiles per employee (model output is *data today*, never authority)
- **MCP servers** — built-in `sprintdesk_*` toolset plus a capability-gated MCP client registry
- **Findings** — the agent's primary output: materialized from the `Findings:` section of completed runs into
  first-class persisted objects with severity/confidence and a review journey
- **Validation & approvals** — agents validate findings (`recommend-approve/reject/request-revision`, confidence,
  reason); humans decide; `auto`/`manual` approval gates for task-assignment, run-execution, and config-change
- **Retry policy** — `maxRunRetries`, `retryBackoffMs`, `runTimeoutMs`, failure classification and
  `availableAt` backoff gating
- **Scheduler & autonomy** — deterministic cron/interval scheduler with autonomy levels `0–3` (default `1`)
- **Execution Windows** — deliberate synchronous batches: `Human → Window → Workflow → Task/Run → Queue →
  Worker → Finding → Validation → Decision`, persisted and reviewable after the fact
- **Event Rules** — `Event → Rule → Workflow → Task/Run` async automation from the existing event stream,
  idempotent and re-entrancy-safe
- **Workflow DSL** — declarative `task` / `loop` / `tool` / `condition` workflows that create queued runs
  (`.SprintDesk/settings/workflows.yml`)

### Quick Access
- Keyboard shortcut: `Ctrl+Shift+T` to add a new task
- Keyboard shortcut: `Ctrl+Shift+Q` to quickly add a task, epic, or backlog
- Quick commands from the command palette

### Multi-Project Support
- Work on multiple projects or repositories
- Switch between projects easily

---

## Getting Started

1. Open VS Code and click the SprintDesk icon in the sidebar
2. Right-click on **Repositories** → **Add Repository**
3. Select your workspace folder
4. Start adding tasks, epics, backlogs, and sprints!

### Commands

| Do This | Use This Command |
|---------|------------------|
| Open the Workforce Control Center | `sprintdesk.openWorkforce` |
| Add a new task | `sprintdesk.addTask` |
| Add multiple tasks | `sprintdesk.addMultipleTasks` |
| Add quickly | `sprintdesk.addQuickly` |
| Add a new sprint | `sprintdesk.addSprint` |
| Add a new backlog | `sprintdesk.addBacklog` |
| Add a new epic | `sprintdesk.addEpic` |
| View projects | `sprintdesk.viewProjects` |
| Show sprint calendar | `sprintdesk.showSprintCalendar` |
| Open sprint file | `sprintdesk.openSprintFile` |
| View team | `sprintdesk.viewTeam` |
| Sync team from Git | `sprintdesk.syncTeamFromGit` |
| View history | `sprintdesk.viewHistory` |
| Refresh | `sprintdesk.refresh` |

---

## Settings

You can customize how SprintDesk works:

| Setting | Default | What It Does |
|---------|---------|--------------|
| `sprintdesk.projectPrefix` | SPD | Project code prefix |
| `sprintdesk.taskPrefix` | task_ | Task ID prefix |
| `sprintdesk.taskStartNumber` | 100 | Starting task number |
| `sprintdesk.sprintPrefix` | sprint_ | Sprint prefix |
| `sprintdesk.defaultBacklog` | features | Default backlog name |
| `sprintdesk.defaultStatus` | waiting | Default task status |
| `sprintdesk.defaultPriority` | medium | Default priority |

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