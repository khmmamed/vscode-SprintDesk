SprintDesk/
│
├── src/
│   │
│   ├── extension.ts
│   │
│   ├── kernel/
│   │   ├── pipeline/
│   │   │   ├── Pipeline.ts
│   │   │   ├── PipelineVersion.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── graph/
│   │   │   ├── Graph.ts
│   │   │   ├── Node.ts
│   │   │   ├── Edge.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── state/
│   │   │   ├── State.ts
│   │   │   ├── StateSchema.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── execution/
│   │   │   ├── PipelineRun.ts
│   │   │   ├── Execution.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── events/
│   │   │   ├── Event.ts
│   │   │   ├── EventBus.ts
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts
│   │
│   ├── runtime/
│   │   ├── Runtime.ts
│   │   ├── Executor.ts
│   │   ├── Scheduler.ts
│   │   └── index.ts
│   │
│   ├── capabilities/
│   │   ├── Capability.ts
│   │   ├── CapabilityVersion.ts
│   │   ├── CapabilityRegistry.ts
│   │   └── index.ts
│   │
│   ├── resources/
│   │   ├── Resource.ts
│   │   ├── ResourceRegistry.ts
│   │   └── index.ts
│   │
│   ├── policies/
│   │   ├── Policy.ts
│   │   ├── PolicyEngine.ts
│   │   └── index.ts
│   │
│   ├── storage/
│   │   ├── Store.ts
│   │   ├── FileStore.ts
│   │   └── index.ts
│   │
│   ├── compiler/
│   │   ├── Compiler.ts
│   │   ├── IR.ts
│   │   └── index.ts
│   │
│   ├── simulation/
│   │   ├── Simulator.ts
│   │   └── index.ts
│   │
│   ├── mcp/
│   │   └── ...
│   │
│   ├── llm/
│   │   └── ...
│   │
│   ├── host/
│   │   ├── VSCodeHost.ts
│   │   └── index.ts
│   │
│   └── ui/
│       └── ...
│
├── test/
│   ├── kernel/
│   ├── runtime/
│   ├── capabilities/
│   ├── compiler/
│   ├── simulation/
│   └── integration/
│
├── webpack/
│   └── extension.config.js
│
├── assets/
│   └── activitybar-icon.svg
│
├── docs/
│   └── ...
│
├── .kilo/
├── .qodo/
├── .SprintDesk/
└── .vscode/