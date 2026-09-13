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

### Workforce & Autonomous Work (experimental)
SprintDesk v0.9 ships an experimental **workforce runtime**: a deterministic, policy-gated pipeline that maps
employees → skills → tools → permissions → tasks, without an LLM in the scheduling path. See
[`docs/v0.9-workforce-guide.md`](docs/v0.9-workforce-guide.md) for the full architecture.

- **Employees & workforce** — human/agent members with certified skills, RBAC roles, and lifecycle gates
  (`.SprintDesk/workforce/*.yml`)
- **Tasks → Runs → Queue → Worker** — a task drives a `run`; queued runs are claimed by a deterministic
  scheduler pass and executed by a headless/terminal/noop worker; every state change flows through
  `startRun` / `finishRun` / `cancelRun`
- **LLM providers** — ollama/openai model profiles per employee (model output is *data today*, never authority)
- **MCP servers** — built-in `sprintdesk_*` toolset plus a capability-gated MCP client registry
- **Events & findings** — lifecycle events (`run.start`, `run.finish`, `run.queued`, ...) persisted with a
  full audit trail
- **Reviews & approval gates** — `auto`/`manual` gates for task-assignment, run-execution, and config-change
  with pending-approval tools
- **Retry policy** — `maxRunRetries`, `retryBackoffMs`, `runTimeoutMs`, failure classification and
  `availableAt` backoff gating
- **Scheduler & autonomy** — deterministic cron/interval scheduler with autonomy levels `0–3` (default `1`)
- **Workflow DSL** — declarative `task` / `loop` / `tool` / `condition` workflows that create queued runs
  (`.SprintDesk/settings/workflows.yml`)

> **⚠️ Experimental.** The workforce runtime is built for headless/extensibility scenarios and covered by the
> smoke suite, but the VS Code UI (webview planning, dashboards) is not yet wired to it. Current limitations:
> no end-to-end employee execution flow (task discovery → assignment → dispatch → review) from the UI;
> condition evaluation reads step status only; tool/LLM output never overrides policy.

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