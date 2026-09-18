# SprintDesk Hard Migration — Phase 0: Clean the Existing Codebase

We are performing a **hard migration of SprintDesk** into the new generic workflow/execution platform architecture.

This is **not** an incremental compatibility migration.

The first step is to clean the existing codebase completely and leave only the infrastructure that is genuinely reusable for the new architecture.

## Objective

Before implementing the new Pipeline/Runtime architecture:

1. Audit the entire existing codebase.
2. Identify what is reusable.
3. Delete obsolete architecture aggressively.
4. Remove legacy concepts rather than adapting them.
5. Remove dead code, compatibility layers, duplicated abstractions, and obsolete tests.
6. Keep only the minimal foundation required for the new system.
7. Ensure the repository is clean, coherent, buildable, and testable after the cleanup.

Do **not** implement the new workflow engine yet.

This phase is exclusively about creating a clean foundation.

---

## Target Architecture Direction

The new SprintDesk will eventually be based around:

```text
Pipeline
PipelineVersion
PipelineRun
Graph
Node
Edge
State
StateSchema
Event
Snapshot
Execution
Capability
CapabilityVersion
Resource
Policy
Trigger
Artifact
Observation
```

The runtime should be generic.

There must be no kernel-level assumptions that a node is specifically:

* an Agent
* a Tool
* an MCP server
* a Human
* a Validator
* a Checkpoint
* a Task
* a Team
* an Employee
* an Organizer
* a Dispatcher
* an Orchestrator

Those may eventually be implemented as capabilities or node types, but they must **not define the kernel architecture**.

---

# Phase 1 — Full Codebase Audit

Before deleting anything, inspect the entire repository.

Map:

```text
src/
tests/
data/
.SprintDesk/
config/
scripts/
package.json
tsconfig*
build configuration
MCP integration
CLI
storage
services
providers
types
utilities
```

For every important file/module classify it as:

```text
KEEP
REWORK
DELETE
UNKNOWN
```

Determine:

* who imports it
* what imports it
* whether it belongs to the old architecture
* whether it contains reusable infrastructure
* whether it has side effects
* whether tests depend on it
* whether configuration depends on it
* whether it will be useful for the new runtime

Do not preserve code merely because it currently has tests.

---

# Phase 2 — Delete the Legacy Architecture

Remove the old workflow lifecycle completely.

Delete concepts and implementations based on:

```text
Task
Task lifecycle
Workforce lifecycle
Team
TeamMember
Employee-specific orchestration
AgentRunner
Orchestrator
Organizer
Dispatcher
Validator
legacy queue
legacy assignment
legacy workforce state
legacy task state
legacy team state
```

Also remove any abstractions whose primary purpose was supporting the old lifecycle.

The new system must **not** contain compatibility wrappers such as:

```text
LegacyTaskAdapter
LegacyDispatcher
LegacyOrchestrator
LegacyTeamService
LegacyAgentRunner
TaskToPipelineAdapter
PipelineTaskBridge
```

Do not preserve the old model under new names.

---

# Phase 3 — Remove Legacy Storage

Delete obsolete storage structures such as:

```text
workforce/
teams/
employees/
tasks/
legacy queue state
legacy orchestration state
legacy agent state
```

Do not migrate these files into the new architecture yet.

The new storage model will be introduced separately.

Keep only storage infrastructure that is genuinely generic and reusable.

Examples of potentially reusable infrastructure:

```text
YAML/JSON serialization
atomic file writes
filesystem utilities
ID generation
schema validation
configuration loading
logging
event primitives
generic persistence utilities
```

Only retain these if they are actually independent of the old domain model.

---

# Phase 4 — Remove Legacy Domain Types

Remove old domain types that encode the previous architecture.

For example:

```text
Task
TaskStatus
TaskAssignment
Team
TeamMember
Employee
AgentStatus
Workforce
QueueItem
Proposal
DispatchRequest
```

Do not rename these into new concepts.

The new domain model will be implemented from scratch.

---

# Phase 5 — Remove Dead APIs and MCP Tools

Audit every MCP/API/CLI tool.

For each tool determine:

```text
USED
REQUIRED FOUNDATION
LEGACY
DEAD
```

Delete tools whose purpose is exclusively tied to the old architecture.

Do not keep obsolete APIs for backward compatibility.

The future MCP surface will be rebuilt around the new runtime and capability model.

---

# Phase 6 — Remove Dead Tests

Delete tests for deleted architecture.

Do not rewrite legacy tests simply to make them pass.

Examples:

```text
task tests
team tests
employee tests
dispatcher tests
organizer tests
old orchestrator tests
legacy agent runner tests
legacy workforce tests
```

Keep tests only when they validate infrastructure that remains.

The principle is:

> Tests must describe the architecture we are keeping, not the architecture we are deleting.

---

# Phase 7 — Dependency Cleanup

After deleting the old architecture:

1. Search for unused npm dependencies.
2. Remove packages used only by deleted features.
3. Remove unused imports.
4. Remove obsolete configuration.
5. Remove obsolete scripts.
6. Remove obsolete environment variables.
7. Remove dead exports.
8. Remove unused type declarations.
9. Remove obsolete build configuration.
10. Remove abandoned documentation that describes deleted architecture.

Do not introduce replacement dependencies yet unless absolutely required to keep the remaining foundation functional.

---

# Phase 8 — Repository Integrity

After cleanup, run:

```bash
npm install
npm run build
npm test
npm run lint
```

Use the actual repository scripts when they differ.

Then perform global searches for legacy terminology.

Search for at least:

```text
Task
taskService
Team
TeamMember
Employee
workforce
AgentRunner
agentRunner
Orchestrator
Organizer
Dispatcher
Validator
queue
assignment
proposal
```

Review every remaining occurrence.

A remaining reference is acceptable only if it is:

* historical documentation that should explicitly remain
* an unrelated generic concept
* required by external tooling

Otherwise remove it.

---

# Phase 9 — Clean Baseline

At the end of this phase the repository should represent:

```text
SprintDesk
   │
   ├── generic infrastructure
   │
   ├── configuration
   │
   ├── persistence primitives
   │
   ├── validation primitives
   │
   ├── logging
   │
   ├── CLI/MCP infrastructure that is genuinely reusable
   │
   └── minimal application bootstrap
```

It should **not yet** contain the complete new workflow engine.

The next phase will introduce the new architecture deliberately from a clean foundation.

---

# Important Rules

### 1. Hard migration

Do not preserve compatibility with the previous SprintDesk architecture.

### 2. Delete first

Do not redesign old modules into the new architecture.

Delete them and implement the new concepts separately.

### 3. No premature implementation

Do not implement Pipeline, Runtime, Capability Registry, Compiler, UI, or AI orchestration in this phase unless a tiny foundational primitive is required.

### 4. No speculative abstractions

Do not create generic abstractions simply because the future architecture might need them.

Keep only proven reusable infrastructure.

### 5. No legacy aliases

Do not rename:

```text
Task → Pipeline
Agent → Capability
Dispatcher → Runtime
Organizer → Compiler
```

These are architecturally different concepts.

### 6. No compatibility layer

The old and new architectures must not coexist.

### 7. Preserve useful infrastructure

Deletion should be aggressive toward **domain architecture**, but conservative toward genuinely reusable infrastructure.

---

# Expected Deliverable

At the end, provide:

## 1. Deleted

List every major deleted module/category.

## 2. Kept

List every retained module and explain why it is reusable.

## 3. Changed

List files that required modification rather than deletion.

## 4. Dependencies Removed

List removed packages and why.

## 5. Tests Removed

List legacy test suites removed.

## 6. Remaining Architecture

Show the resulting directory/module structure.

## 7. Verification

Report:

```text
Build: PASS/FAIL
Tests: PASS/FAIL
Lint: PASS/FAIL
Typecheck: PASS/FAIL
```

## 8. Legacy Search

Report remaining occurrences of old architectural terms and explain each one.

## 9. Commit

Create one clean migration commit:

```text
refactor: clean codebase for workflow runtime migration
```

Do not begin implementing the new architecture until this cleanup phase is complete and verified.
