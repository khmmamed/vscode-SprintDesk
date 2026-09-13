# SprintDesk Current Features

## Core Features

### 📋 Task Management
- Create and manage tasks as Markdown files
- Task status tracking (Planned, In Progress, Completed, Blocked)
- Task prioritization
- Quick task creation via "Add Quickly" command
- Task linking and relationships
- Task metadata tracking (creation date, updates, owner)

### 📊 Project Organization
- Epics management for grouping related tasks
- Backlog organization and tracking
- Sprint planning and management
- Project structure scanning and visualization
- Hierarchical task organization

### 🔄 Sprint Management
- Sprint creation and planning
- Sprint calendar visualization
- Add existing tasks to sprints
- Sprint progress tracking
- Sprint file management
- Sprint status updates

### 📈 Epic Management
- Epic creation and organization
- Epic status tracking
- Epic color coding
- Task grouping under epics
- Epic progress visualization
- Epic metadata management

### 📱 User Interface
- Dedicated sidebar view
- Project structure tree view
- Tasks table view
- Backlogs view
- Epics view
- Sprints view
- Context menu integration
- Command palette integration

### 🔗 Integration Features
- Git flow integration
  - Feature branch creation from tasks
  - Task status updates with git actions
- VS Code native integration
  - File system integration
  - Workspace management
  - Command palette support
  - Context menu support

### 📝 Documentation Support
- Markdown-based documentation
- Auto-generated task templates
- Linked documentation structure
- Task relationship documentation
- Project documentation management

### 💼 Project Management
- Multiple project support
- Project structure visualization
- Project metadata tracking
- Project status monitoring
- Project organization tools

## Workforce & Autonomous Work (experimental, v0.7–v0.9)

> ⚠️ **Experimental.** Headless-first and covered by the smoke suite. The VS Code UI (webview planning,
> dashboards) is not yet wired to the workforce runtime. See
> [`v0.9-workforce-guide.md`](v0.9-workforce-guide.md) and the milestone contracts for details.

### 👥 Employees & Workforce
- Human/agent employees with certified skills (`.SprintDesk/workforce/skills.yml`, seeded catalog of 8)
- Teams with lead/member assignment and Git-history sync
- Skill catalog, aliases, and task-type → required-skill mapping
- Deterministic `rankEmployees` assignee recommendations (coverage → load → status → name → id)

### 🔐 RBAC & Policy
- Role → permission matrix (`lead` / `developer` / `reviewer` / `observer` / `agent` / `human`)
- Per-employee allow/deny overrides (`.SprintDesk/workforce/policy.yml`)
- Lifecycle gates on assignment, claim, and run start

### 🔄 Queue, Runs & Worker
- Task → Run → Queue → Worker pipeline (`.SprintDesk/data/runs.yml`)
- Deterministic scheduler pass: `createdAt asc → attempts asc → id asc`, explicit skip reasons
- Single transition path `startRun` / `finishRun` / `cancelRun` with audit events
- Headless (spawn), terminal, and noop worker runtimes

### 🔁 Retry Policy
- `maxRunRetries`, `retryBackoffMs` backoff gating, `runTimeoutMs` per-run timeout
- Failure classification and `availableAt` requeue gating

### 📅 Scheduler & Autonomy
- Deterministic cron and interval schedules (`.SprintDesk/settings/schedules.yml`)
- Idempotent firing; autonomy levels `0–3` (default `1`) bound classified work

### 🧠 LLM Providers
- ollama / openai clients behind a credential facade
- Per-employee `modelProfile` selection (model output today is data, never authorization)

### 🔌 MCP Servers & Toolset
- Built-in `sprintdesk_*` toolset (70 tools) over HTTP/stdio
- External MCP server registry (`.SprintDesk/mcp/servers.yml`) with capability-gated `mcpCall`

### 📡 Events & Findings
- Lifecycle event emission (`.SprintDesk/data/events.yml`) on run / queue / employee transitions
- Activity summary, audit trail, and history tracking

### ✅ Reviews & Approval Gates
- `auto` / `manual` gates for task-assignment, run-execution, config-change
- Pending approvals (`.SprintDesk/workforce/approvals.yml`) with approve/reject tools

### 📋 Workflow DSL
- Declarative `task` / `loop` / `tool` / `condition` workflows (`.SprintDesk/settings/workflows.yml`)
- Deterministic, bounded engine; `continueOnError` escape hatch; tool steps route through MCP
- Conditions read step status only — LLM/tool output stays data

## Technical Features

### 🛠 System Integration
- File system management
- Git integration
- VS Code extension API utilization
- Workspace folder management
- File watching and updates

### 🔧 Configuration
- Project-specific settings
- Template customization
- Metadata configuration
- Status types configuration
- Priority levels configuration

### 🎨 UI/UX Features
- Intuitive sidebar interface
- Context-aware commands
- Quick action buttons
- Status icons and indicators
- Progress visualization
- Tree view navigation