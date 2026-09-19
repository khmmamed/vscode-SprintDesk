Below is the full milestone sequence I would use from the current **2.12 frozen state** through the first generic execution platform.

### Milestone map

```text
CURRENT
2.12 Pipeline Persistence Completeness
205 tests
    │
    ▼
2.13 NodeRun
    │
    ▼
2.14 Pipeline Engine
    │
    ▼
2.15 Dispatcher
    │
    ▼
2.16 Trigger / Event Integration
    │
    ▼
2.17 Execution Recovery
    │
    ▼
2.18 Capability / Resource Runtime Completion
    │
    ▼
2.19 Pipeline Registry + Version Resolution
    │
    ▼
2.20 Generic Development Surface
```

---

# 2.13 — NodeRun / Execution Trace

**Goal:** make every pipeline execution observable at node level.

### Kernel

Add:

```text
src/kernel/execution/NodeRun.ts
```

Model:

```ts
NodeRun {
  id
  executionId
  nodeId
  status
  startedAt?
  finishedAt?
  error?
}
```

Lifecycle:

```text
queued
  ↓
running
  ├──→ succeeded
  ├──→ failed
  └──→ cancelled
```

Keep it immutable/state-transition based like `PipelineRun`.

### Execution

Extend `Execution`:

```text
Execution
├── PipelineRun
├── NodeRuns[]
├── finalState
├── status
└── error
```

Provide lookup:

```ts
nodeRun(nodeId)
nodeRuns()
```

### Executor

For every node:

```text
NodeRun queued
    ↓
execution.node.started
    ↓
NodeRun running
    ↓
 ┌─────────────┬─────────────┬──────────────┐
 success       failure       cancellation
 ↓             ↓             ↓
finished       failed        cancelled
```

Events:

```text
execution.node.started
execution.node.finished
execution.node.failed
execution.node.cancelled
```

### Persistence

Extend `StoredRun`:

```ts
{
  id,
  pipelineId?,
  version?,
  status,
  startedAt?,
  finishedAt?,
  error?,
  result?,
  nodeRuns?
}
```

Legacy records without these fields remain valid.

**Plain data only.**

Do not persist `Execution`, promises, signals, handlers, registries, or runtime objects.

### Runtime

Runtime must persist node-run transitions through the existing run persistence mechanism.

### Harness

Expose:

```text
dev pipeline
  Node A
  Node B
  Node C
```

and allow:

* success
* failure
* cancellation

### Inspection

```text
SprintDesk
├── Pipelines
│   └── Dev Pipeline
│       └── Versions
│           └── Graph
│               ├── Node A
│               ├── Node B
│               └── Node C
├── Runs
│   └── Run
│       ├── Node A — succeeded
│       ├── Node B — running
│       └── Node C — queued
├── Schedules
├── Capabilities
├── Resources
└── Artifacts
```

### Freeze condition

All node lifecycle transitions, cancellation, persistence, recovery compatibility, inspection, and tests are green.

---

# 2.14 — Generic PipelineEngine

**Goal:** introduce the first real pipeline-level execution abstraction.

Current:

```text
Runtime
   ↓
Executor
   ↓
PipelineVersion
```

Target:

```text
PipelineEngine
   ↓
Pipeline
   ↓
PipelineVersion
   ↓
Execution
```

### Add

```text
src/runtime/PipelineEngine.ts
```

Responsibilities:

* resolve a pipeline
* resolve the requested version
* resolve latest version when requested
* create `PipelineRun`
* delegate actual execution to Runtime/Executor
* return execution/run identity

Conceptually:

```ts
engine.run({
  pipelineId,
  version?: string,
  initialState?
})
```

Resolution:

```text
pipelineId
    ↓
PipelineRegistry
    ↓
Pipeline
    ↓
requested version
    │
    └── absent → latestVersion
    ↓
PipelineVersion
    ↓
Runtime
```

### Important boundary

`PipelineEngine` **does not execute nodes itself**.

It orchestrates pipeline identity/version resolution.

```text
Engine = WHAT pipeline
Runtime = RUN lifecycle
Executor = HOW graph executes
```

### Add PipelineRegistry

Only the minimum needed:

```ts
register(pipeline)
get(id)
has(id)
list()
remove(id)
```

No persistence yet unless required by the existing architecture.

### Tests

Cover:

* pipeline lookup
* missing pipeline
* explicit version
* latest version
* missing version
* immutable versions
* run identity
* initial state
* execution failure propagation

### Freeze

The platform can now execute:

```text
engine.run("pipeline-A")
```

without knowing anything about the graph internally.

---

# 2.15 — Dispatcher

**Goal:** separate "request execution" from "execution scheduling."

Architecture:

```text
Trigger / API / Event
        │
        ▼
    Dispatcher
        │
        ▼
 PipelineEngine
        │
        ▼
      Runtime
        │
        ▼
     Executor
```

### Dispatcher responsibilities

```text
dispatch(request)
cancel(runId)
status(runId)
```

Potential request:

```ts
DispatchRequest {
  pipelineId
  version?
  initialState?
  trigger?
}
```

### Queue

Start with a minimal in-memory queue.

Do **not** build a distributed queue.

States:

```text
queued
dispatched
running
completed
failed
cancelled
```

### Concurrency

Add a configurable limit:

```text
maxConcurrentRuns
```

Example:

```text
queue
 ├── Run A → running
 ├── Run B → running
 ├── Run C → queued
 └── Run D → queued
```

### Important distinction

Scheduler:

```text
"When should something run?"
```

Dispatcher:

```text
"Which execution request should run?"
```

Engine:

```text
"Which pipeline/version should execute?"
```

Runtime:

```text
"Manage this run."
```

Executor:

```text
"Execute this graph."
```

---

# 2.16 — Trigger / Event Integration

Now connect the existing Scheduler/EventBus to the new engine/dispatcher architecture.

Target:

```text
Schedule
   ↓
Scheduler
   ↓
Dispatcher
   ↓
PipelineEngine
   ↓
Runtime
```

Instead of Scheduler directly being the primary execution boundary.

### Trigger types

Existing:

```text
manual
interval
event
```

Extend the model only where necessary to identify:

```ts
pipelineId
version?
```

### Event path

```text
EventBus
   ↓
Scheduler
   ↓
Dispatcher
   ↓
PipelineEngine
```

### Manual path

```text
VS Code command
   ↓
Dispatcher
   ↓
PipelineEngine
```

This gives all entry points one execution path.

---

# 2.17 — Recovery / Restart Semantics

At this point the platform has:

```text
Pipeline
PipelineVersion
PipelineRun
NodeRun
Dispatcher
Runtime
Scheduler
```

Now make restart semantics coherent.

### Runtime recovery

Existing behavior:

```text
queued/running → failed
```

Extend to node level:

```text
PipelineRun running
    ↓ restart
PipelineRun failed

NodeRun running
    ↓
NodeRun failed
```

Determine explicitly whether queued nodes become:

```text
cancelled
```

or remain queued and are reconstructed.

I recommend making this an explicit contract rather than allowing accidental behavior.

### Dispatcher recovery

Persist enough dispatcher state to determine what happened to queued requests.

Do not persist live runtime objects.

---

# 2.18 — Capability / Resource Runtime Completion

Capabilities and resources already exist, but now formalize their position in the generic runtime.

Target:

```text
Node
 ├── capabilityId
 └── resourceReferences[]
          ↓
CapabilityRegistry
          ↓
CapabilityHandler
          ↓
ResourceResolver
          ↓
Resources
```

### Capability contract

Clarify:

```text
Capability
CapabilityVersion
CapabilityHandler
```

without introducing agent/tool/MCP-specific concepts into the kernel.

### Resource contract

Clarify:

```text
Resource
ResourceReference
ResourceResolver
```

Resources remain descriptive/read-only from the runtime's perspective.

### Execution context

Eventually:

```ts
CapabilityNodeInput {
  node
  state
  signal
  artifacts
  resources
}
```

Keep this generic.

---

# 2.19 — Pipeline Registry + Version Resolution

Now make pipelines first-class platform objects.

Move from development-only:

```text
const devPipeline = ...
```

to:

```text
PipelineRegistry
    │
    ├── Pipeline A
    │     ├── v1
    │     ├── v2
    │     └── v3
    │
    └── Pipeline B
          ├── v1
          └── v2
```

### Pipeline lifecycle

```text
Pipeline
    ↓
draft version
    ↓
published version
    ↓
immutable version
```

Do not allow execution of mutable definitions.

### Version resolution

Support:

```text
latest
explicit version
version id
```

Potential future:

```text
stable
canary
```

but don't implement those yet.

### Persistence

Only now decide whether PipelineRegistry itself needs durable storage.

The important thing is that pipeline identity/version is no longer reconstructed by the dev harness.

---

# 2.20 — Generic Development Surface

At this point the VS Code surface should stop being a "dev pipeline viewer" and become a generic runtime inspector.

```text
SprintDesk
├── Pipelines
│   ├── Pipeline A
│   │   ├── Versions
│   │   │   ├── v1
│   │   │   │   └── Graph
│   │   │   └── v2
│   │   └── Runs
│   └── Pipeline B
├── Runs
│   ├── Run 001
│   │   ├── Pipeline
│   │   ├── Status
│   │   └── Node Runs
│   └── Run 002
├── Schedules
├── Capabilities
├── Resources
└── Artifacts
```

Commands become generic:

```text
Run Pipeline
Cancel Run
Refresh SprintDesk
Create Schedule
Remove Schedule
Emit Event
```

The UI should read from the actual registries/runtime stores, never maintain its own execution state.

---

# The resulting architecture

After 2.20:

```text
                         ┌───────────────┐
                         │   Pipeline    │
                         └───────┬───────┘
                                 │
                         PipelineVersion
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ PipelineEngine  │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   Dispatcher    │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │     Runtime     │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    Executor     │
                        └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
                  Node         Node         Node
                    │
              capabilityId
                    │
                    ▼
             CapabilityHandler
                    │
                    ▼
             ResourceResolver
```

With execution state alongside it:

```text
PipelineRun
     │
     └── Execution
           │
           ├── NodeRun
           ├── NodeRun
           ├── NodeRun
           │
           ├── State
           ├── Artifacts
           └── Events
```

And entry points:

```text
             ┌───────────┐
             │   Manual  │
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │  Trigger  │
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │ Scheduler │
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │ Dispatcher│
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │  Engine   │
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │  Runtime  │
             └─────┬─────┘
                   │
             ┌─────▼─────┐
             │ Executor  │
             └───────────┘
```

### What I would **not** introduce yet

Until these milestones are complete, avoid:

* Agent abstraction
* Tool abstraction
* MCP abstraction
* LLM integration
* distributed workers
* external queues
* DAG optimization
* retries beyond clearly defined runtime semantics
* parallel node execution
* human approval nodes
* visual canvas
* AI-generated pipelines
* self-healing
* pipeline evolution
* multi-machine execution

