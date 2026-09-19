# SprintDesk 3.x — Platform Layer

## Purpose

3.x turns the completed SprintDesk runtime into a usable platform for humans and applications.

The 2.x runtime answers:

> How does SprintDesk execute a program?

The 3.x platform answers:

> How do users create, inspect, configure, operate, and manage those programs?

3.x must consume the frozen 2.x runtime contracts rather than redefining them.

---

# 3.0 — Platform Foundation

Establish the platform-level APIs and services above the runtime.

### Goals

* Platform service boundary.
* Stable APIs around Pipeline, PipelineVersion, Run, Schedule, Capability, Resource, and Artifact.
* Unified platform identity/reference model.
* Platform-level validation.
* Consistent error and lifecycle reporting.
* Runtime remains the execution authority.

### Result

```text
Platform API
     ↓
Runtime
     ↓
Executor
```

No new execution semantics.

---

# 3.1 — Pipeline Authoring

Create and modify pipelines through a platform representation.

### Goals

* Pipeline creation.
* Pipeline metadata.
* Pipeline version creation.
* Immutable versioning.
* Node creation/editing.
* Edge creation/editing.
* State schema editing.
* Capability selection.
* Resource reference configuration.
* Retry configuration.
* Validation before publishing.

### Rule

Editing creates a new PipelineVersion.

Existing executable versions remain immutable.

---

# 3.2 — Pipeline Definition / IR

Establish the canonical programmable representation of a pipeline.

Supported projections should converge on the same internal representation:

```text
Visual Editor
      │
YAML / JSON
      │
SDK
      │
AI
      ↓
Pipeline IR
      ↓
PipelineVersion
```

### Goals

* Canonical Pipeline IR.
* Serialization.
* Deserialization.
* Schema validation.
* Version compatibility.
* Structural graph validation.
* Deterministic normalization.

The IR becomes the common language of the platform.

---

# 3.3 — Visual Pipeline Editor

Build the visual authoring surface.

### Goals

* Graph canvas.
* Node palette.
* Capability discovery.
* Resource selection.
* Edge editing.
* State/schema visualization.
* Retry configuration.
* Validation feedback.
* Version creation.
* Draft vs published version.

The canvas is a projection of Pipeline IR, not a separate workflow model.

---

# 3.4 — Capability Catalog

Turn the existing capability registry into a platform-managed catalog.

### Goals

* Browse capabilities.
* Capability metadata.
* Versions.
* Input/output descriptions.
* Handler availability.
* Documentation.
* Capability compatibility.
* Capability lifecycle.

Example:

```text
Capabilities
├── HTTP
├── SQL
├── Browser
├── Email
├── File
├── MCP
└── Human Approval
```

The catalog describes what is available.

It does not execute capabilities.

---

# 3.5 — Resource Catalog

Build the platform-facing resource management layer.

### Goals

* Resource discovery.
* Resource metadata.
* Resource versions.
* Resource references.
* Connection configuration.
* Availability status.
* Resource validation.
* Resource usage visibility.

Secrets and credentials must not be embedded directly into pipeline definitions.

---

# 3.6 — Artifact Platform

Expose artifacts as first-class platform objects.

### Goals

* Artifact browser.
* Artifact metadata.
* Artifact references.
* Artifact lineage.
* Artifact retention.
* Artifact inspection.
* Artifact download/viewing where applicable.

Relationship:

```text
PipelineRun
    ↓
NodeRun
    ↓
Attempt
    ↓
Artifact
```

---

# 3.7 — Run Control Center

Create the operational execution interface.

### Goals

* Active runs.
* Historical runs.
* Pipeline/version identity.
* Node status.
* Attempt history.
* State versions.
* Errors.
* Cancellation.
* Run filtering.
* Run inspection.

Visualization:

```text
Run
 ├── Pipeline
 ├── Version
 ├── Status
 ├── Nodes
 │    ├── Node
 │    │    ├── Attempt 1
 │    │    └── Attempt 2
 │    └── Node
 └── Artifacts
```

---

# 3.8 — Debugging / Time-Aware Inspection

Make executions explainable.

### Goals

* Node-by-node inspection.
* State snapshots.
* Event history.
* Attempt history.
* Artifact lineage.
* Failure context.
* Execution timeline.
* Historical state inspection.

This should prepare the architecture for later time-travel debugging.

---

# 3.9 — Policies / Authorization

Introduce platform-level governance.

### Goals

* Users.
* Roles.
* Permissions.
* Pipeline ownership.
* Capability permissions.
* Resource permissions.
* Execution permissions.
* Artifact access.
* Environment separation.

Policy evaluation belongs above the kernel.

---

# 3.10 — Secrets / Credentials

Introduce secure resource credentials.

### Goals

* Secret references.
* Credential providers.
* Secret injection at execution time.
* No secret persistence inside Pipeline IR.
* Rotation support.
* Access auditing.

Conceptually:

```text
Pipeline
   ↓
ResourceReference
   ↓
Resource
   ↓
CredentialReference
   ↓
Secret Provider
```

---

# 3.11 — Observability

Build platform-wide operational visibility.

### Goals

* Structured execution logs.
* Metrics.
* Event monitoring.
* Run duration.
* Node duration.
* Attempt statistics.
* Capability failures.
* Resource failures.
* Scheduler activity.
* Dispatcher activity.

Do not alter runtime semantics merely to produce observability.

---

# 3.12 — Platform API / SDK

Expose SprintDesk to external applications.

### Goals

* Pipeline API.
* Version API.
* Run API.
* Schedule API.
* Capability API.
* Resource API.
* Artifact API.
* Event API.
* SDK.
* Stable contracts.

---

# 3.13 — Environments / Promotion

Introduce controlled deployment of pipeline versions.

```text
Draft
  ↓
Validated
  ↓
Published
  ↓
Staging
  ↓
Production
```

### Goals

* Environment identity.
* Version promotion.
* Rollback.
* Validation gates.
* Environment-specific resources.
* Configuration overlays.

---

# 3.14 — Platform Hardening

Final 3.x stabilization.

### Goals

* Performance.
* Large graph handling.
* Large run history.
* Persistence robustness.
* API compatibility.
* Security hardening.
* Migration tooling.
* Backup/restore.
* Operational documentation.

---

# 3.x Definition of Done

3.x is complete when SprintDesk provides:

```text
Create
  ↓
Validate
  ↓
Version
  ↓
Publish
  ↓
Schedule / Trigger
  ↓
Execute
  ↓
Inspect
  ↓
Debug
  ↓
Manage
```

through a coherent platform interface.

The runtime remains underneath all of these capabilities.

3.x does not introduce autonomous AI behavior.

That belongs to 4.x.
