## Objective
- Implement SprintDesk 2.19 — Capability/Resource Runtime Completion in the vscode-SprintDesk repo: freeze the execution contract (capability lifecycle, resource lifecycle, persistence validation, execution context, artifact isolation, retry integration, failure-kind observability), with a new acceptance test file `test/runtime/capability-resource.test.ts` (29 scenarios) and all four gates green on top of the frozen 2.18 baseline (314 passing).

## Status
2.19 is DONE. All four gates pass:
- `npx tsc --noEmit -p tsconfig.json` — no output (also `npm run compile-tests` via `tsconfig.test.json` passes).
- `eslint src --ext ts` — clean.
- `npm test` — **343 passing, 0 failing** (314 baseline + 29 new capability/resource scenarios).
- `npm run compile` — webpack compiled successfully.
- Note: same pre-existing scheduler timer flake as 2.18 can intermittently appear under full-suite load; it passes in isolation and was not caused by this slice.

## What was built
### Contract frozen this slice
- **Capability is what executes**: `Executor` resolves the registered `Capability` (unpinned nodes bind to whatever version is registered), verifies optional version pins, resolves the matching `CapabilityHandler`, then passes exactly `{ node, state, signal, artifacts, resources }` + `{ executionId, version }` — no registries, executor, or hidden service locator reachable from a handler.
- **Resource is what execution uses**: declared references are resolved once **per attempt** (each retry re-resolves), identity and optional version are verified through `Resource.matches`, a non-matching or failing resolve is a `kind: "resource"` failure and the handler never runs.
- **Attempt is when execution happens**: retry compatibility carries both the per-attempt failure kind and the final node kind through events and persistence.
- **Failure-kind observability**: `NodeFailureKind = "action" | "capability" | "resource"`, threaded from `NodeExecutionError` through kernel node runs, executor events (`execution.run.failed`, `execution.node.failed`, `execution.node.attempt.failed`), `Runtime.follow`, and run persistence.

### Kernel
- `src/kernel/capabilities/Capability.ts`: `Capability.version` is now validated as a positive integer (was untyped/absent) — invalid versions throw `DomainError` INVALID_INPUT.
- `src/kernel/execution/NodeRun.ts`: new `NodeFailureKind` type; `NodeRun.failureKind?`, `NodeAttempt.failureKind?`, `NodeRunOptions.failureKind?`; `fail(error, now, failureKind?)` / `failAttempt(error, now, failureKind?)` set the kind on the node/attempt; `transition` and `start` preserve it (cancels never set it).
- `src/kernel/execution/index.ts`: exports `NodeFailureKind`.

### Runtime
- `src/runtime/Executor.ts`: fixed the incomplete refactor — the executor's private `resolveCapability`/`resolveHandler`/`resolveResources` became module-level functions over the executor's public registries/resolver (compile was broken: private methods were referenced from module-level `runCapabilityNode`); `NodeFailureKind` is now re-exported from the kernel; `failAttempt`/`fail` receive the `NodeExecutionError.kind` so per-attempt and final-node failure kinds surface on `NodeRun`/`NodeAttempt` and in `execution.node.attempt.failed` / `execution.node.failed` payloads (`execution.run.failed` already carried `kind`).
- `src/runtime/persistence/RunStore.ts`: `StoredNodeRun.failureKind?` / `StoredNodeAttempt.failureKind?`; `toStoredNodeRun` writes them only when defined (preserves the exact-key assertion in pipeline-run.test.ts); `parseStoredNodeRun`/`parseStoredNodeAttempt` validate `failureKind` against `["action","capability","resource"]` and reject malformed values ("Malformed persisted run data"); legacy records without `failureKind` parse fine.
- `src/runtime/Runtime.ts`: the `follow` `execution.node.failed` handler persists `failureKind` from the event payload, so `runtime.status(id).nodes` and `FileRunStore.get(id)` expose it and it survives restart hydration.
- Persistence validation for capability/resource definitions is inherited: `parseStoredPipeline → fromStoredPipeline → fromStoredPipelineVersion → new Node(...)` already rejects a non-positive/float `capabilityVersion`, non-array `resourceReferences`, and non-string/empty reference entries, wrapped as "Malformed persisted pipeline data".

### Tests (`test/runtime/capability-resource.test.ts`, 29 scenarios)
- Capability version lifecycle (4): version validated as positive integer; pinned node resolves when versions match; pinned node with differing registered version fails with `kind: "capability"` on node run + events; unpinned node resolves.
- Handler failure/cancellation semantics (2): handler failure surfaces `failureKind: "capability"`; cancelled capability nodes leave `failureKind` unset.
- Resource version lifecycle (4): versioned reference matches; mismatched versioned reference fails with `kind: "resource"` (handler never runs); unversioned reference resolves regardless of version; async resolver rejection fails with `kind: "resource"`.
- Capability/resource persistence (5): `capabilityVersion` + resource refs round-trip through pipeline storage and execute after a JSON round-trip; malformed persisted `capabilityVersion`, non-array `resourceReferences`, and non-string reference entry rejected as malformed.
- FailureKind persistence (5): Runtime + FileRunStore persist capability and resource failure kinds; `toStoredNodeRun`/`parseStoredRun` round-trip it while legacy records stay valid; malformed persisted `failureKind` rejected; failure kind survives Runtime restart hydration.
- Execution context contract (1): handler receives exactly `["node","state","signal","artifacts","resources"]` and `["executionId","version"]` — no hidden registries/executor on the contract.
- Capability artifacts and attempts (3): success commints artifacts; retry commits only the successful attempt's artifacts; exhausted retries commit nothing and leave `failureKind: "capability"`.
- Retry integration frozen contract (3): resources re-resolved once per attempt (fresh instances counted); transient resource failures are tagged per attempt and retry to success; final capability exhaustion aggregates `failureKind: "capability"` on the node across 3 tagged attempts.
- Observability (2): `execution.node.failed` carries `action` vs `capability` vs `resource` across three runs; `execution.node.attempt.failed` carries the kind during capability retries.

## Notes / observations
- The frozen resource-resolution semantics (once per attempt) are now documented by dedicated tests in addition to the 2.18 retry counting test; 2.20 (Worker/Execution Backend) can build on these concepts without redefining them.
- Event-stream compatibility is preserved: `failureKind` is only added to a `StoredNodeRun`/`StoredNodeAttempt` when defined, and kind tags on events are conditionally spread, so exact-key/event-list assertions in executor.test.ts, executor-capability.test.ts and pipeline-run.test.ts stay green.
- Known pre-existing flake (NOT a 2.19 regression, passes in isolation): `Scheduler triggers (timer-based)` / "rescheduling the same id after unschedule regenerates a single timer" can intermittently see an extra 20ms-interval dispatch under full-suite CPU load. Scheduler code was not touched.

## Relevant files
- `test/runtime/capability-resource.test.ts` — new 2.19 acceptance test (29 scenarios).
- `src/kernel/capabilities/Capability.ts` — version validation.
- `src/kernel/execution/NodeRun.ts`, `src/kernel/execution/index.ts` — `NodeFailureKind` + `failureKind` on node/attempt.
- `src/runtime/Executor.ts` — resolve helpers as module functions (fixes broken compile), failure-kind threading, kernel re-export.
- `src/runtime/persistence/RunStore.ts` — `failureKind` persistence + validation.
- `src/runtime/Runtime.ts` — `follow` persists failure kind; restart hydration exposes it.
- Reference/constraints: `test/runtime/executor.test.ts` + `test/runtime/executor-capability.test.ts` (exact event lists), `test/runtime/pipeline-run.test.ts` (exact toStoredNodeRun keys), `test/runtime/retry.test.ts` (2.18 baseline incl. per-attempt resource resolution), `test/runtime/resource-resolution.test.ts`, `test/runtime/pipeline-persistence.test.ts`.

## Next steps (future work, not requested)
- None required for 2.19. Potential follow-up: 2.20 Worker/Execution Backend on top of the now-frozen capability/resource/attempt concepts.