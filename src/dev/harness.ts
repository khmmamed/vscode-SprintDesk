import { 
  Executor, 
  NodeAction,
  ExecutionCancelledError
} from "../runtime/Executor.js";
import { 
  PipelineVersion, 
  Pipeline,
  PipelineRegistry,
  Graph, 
  Node, 
  StateSchema, 
  State,
  EventBus,
  Capability,
  CapabilityRegistry,
  CapabilityHandlerRegistry,
  Resource,
  ResourceRegistry,
  DomainError,
} from "../kernel/index.js";
import { Runtime } from "../runtime/Runtime.js";
import {
  Scheduler,
  Schedule,
  FileRunStore,
  FileScheduleStore,
  FilePipelineStore,
  fromStoredPipeline,
  toStoredPipeline,
  ArtifactStore,
  MemoryArtifactStore
} from "../runtime/index.js";

export interface DevHarnessOptions {
  readonly runStoreFile?: string;
  readonly scheduleStoreFile?: string;
  readonly pipelineStoreFile?: string;
}

export class DevHarness {
  private executor: Executor;
  private runtime: Runtime;
  private scheduler: Scheduler;
  private eventBus: EventBus;
  private currentRunId?: string;
  private currentVersion?: PipelineVersion;
  private readonly pipelineRegistry = new PipelineRegistry();
  private readonly filePipelineStore?: FilePipelineStore;
  private readonly capabilityRegistry = new CapabilityRegistry();
  private readonly handlerRegistry = new CapabilityHandlerRegistry();
  private readonly resourceRegistry = new ResourceRegistry();
  private readonly artifactStore = new MemoryArtifactStore();

  constructor(options: DevHarnessOptions = {}) {
    this.setupCapabilities();
    this.setupResources();

    const devActions: NodeAction[] = [
      {
        type: "dev.log",
        run: async ({ node, state }) => {
          console.log(`Executing node ${node.id} (${node.type})`);
          return state;
        }
      },
      {
        type: "dev.increment",
        run: async ({ node, state }) => {
          const val = (state.value.counter ?? 0) as number;
          return state.withValue("counter", val + 1);
        }
      },
      {
        type: "dev.slow",
        run: async ({ node, state, signal }) => {
          console.log(`Node ${node.id} starting slow work (5s)...`);
          
          const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
          
          const abort = new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(new ExecutionCancelledError());
            }, { once: true });
          });

          await Promise.race([timeout, abort]);
          
          console.log(`Node ${node.id} finished slow work.`);
          return state;
        }
      },
      {
        type: "dev.artifact",
        run: async ({ node, state }) => {
          console.log(`Node ${node.id} emitting artifact...`);
          return state;
        }
      }
    ];

    this.executor = new Executor({ actions: devActions });
    this.eventBus = new EventBus();
    this.runtime = new Runtime({
      executor: this.executor,
      runStore: options.runStoreFile ? new FileRunStore({ filePath: options.runStoreFile }) : undefined,
    });
    this.scheduler = new Scheduler({
      runtime: this.runtime,
      eventBus: this.eventBus,
      scheduleStore: options.scheduleStoreFile
        ? new FileScheduleStore({ filePath: options.scheduleStoreFile })
        : undefined,
    });

    this.filePipelineStore = options.pipelineStoreFile
      ? new FilePipelineStore({ filePath: options.pipelineStoreFile })
      : undefined;
    this.loadPipelines();
    this.seedPipelines();
  }

  private loadPipelines() {
    if (!this.filePipelineStore) {
      return;
    }
    for (const stored of this.filePipelineStore.list()) {
      this.pipelineRegistry.register(fromStoredPipeline(stored));
    }
  }

  private seedPipelines() {
    const example = new Pipeline({
      id: "dev.example",
      name: "Dev Example Pipeline",
      versions: [this.buildExampleVersion()],
    });
    if (!this.pipelineRegistry.has(example.id)) {
      this.registerPipeline(example);
    }
    const cancellation = new Pipeline({
      id: "dev.cancellation",
      name: "Dev Cancellation Pipeline",
      versions: [this.buildCancellationVersion()],
    });
    if (!this.pipelineRegistry.has(cancellation.id)) {
      this.registerPipeline(cancellation);
    }
  }

  private setupCapabilities() {
    const cap = new Capability({
      id: "dev.cap.example",
      type: "example-cap",
      version: 1
    });
    this.capabilityRegistry.register(cap);

    this.handlerRegistry.register({
      capabilityId: cap.id,
      run: async (input: any, context: any) => {
        console.log("Capability executing...");
        return { result: "success" };
      }
    });
  }

  private setupResources() {
    const res = new Resource({
      id: "dev.res.config",
      type: "config-file",
      version: "1.0.0"
    });
    this.resourceRegistry.register(res);
  }

  async runExample() {
    return this.runPipeline("dev.example");
  }

  async runCancellationExample() {
    return this.runPipeline("dev.cancellation");
  }

  runPipeline(pipelineId: string): string {
    const pipeline = this.pipelineRegistry.get(pipelineId);
    const version = pipeline.latestVersion();
    if (!version) {
      throw new DomainError({
        code: "NOT_FOUND",
        message: `Pipeline "${pipelineId}" has no versions to run`,
        details: { pipelineId },
      });
    }
    this.currentVersion = version;
    this.currentRunId = this.runtime.start(version, { pipelineId });
    return this.currentRunId;
  }

  schedulePipeline(id: string, version: PipelineVersion = this.buildExampleVersion()): Schedule {
    return this.scheduler.schedule({ id, version });
  }

  scheduleIntervalPipeline(id: string, everyMs = 1000, version: PipelineVersion = this.buildExampleVersion()): Schedule {
    return this.scheduler.schedule({ id, version, trigger: { type: "interval", everyMs } });
  }

  scheduleEventPipeline(id: string, eventType: string, version: PipelineVersion = this.buildExampleVersion()): Schedule {
    return this.scheduler.schedule({ id, version, trigger: { type: "event", eventType } });
  }

  publishDevEvent(type: string): void {
    this.eventBus.publish(type);
  }

  triggerPipeline(id: string): string {
    this.currentRunId = this.scheduler.trigger(id);
    return this.currentRunId;
  }

  listSchedules(): readonly Schedule[] {
    return this.scheduler.list();
  }

  unschedulePipeline(id: string): boolean {
    return this.scheduler.unschedule(id);
  }

  startScheduler(): void {
    this.scheduler.start();
  }

  stopScheduler(): void {
    this.scheduler.stop();
  }

  getRunCount(): number {
    return this.runtime.runs().length;
  }

  cancelRun() {
    if (!this.currentRunId) {
      return false;
    }
    return this.runtime.cancel(this.currentRunId);
  }

  getRunStatus(): ReturnType<Runtime["status"]> | null {
    if (!this.currentRunId) {
      return null;
    }
    return this.runtime.status(this.currentRunId);
  }

  getVersion() {
    return this.currentVersion;
  }

  listPipelines(): readonly Pipeline[] {
    return this.pipelineRegistry.list();
  }

  getPipeline(id: string): Pipeline {
    return this.pipelineRegistry.get(id);
  }

  registerPipeline(pipeline: Pipeline): Pipeline {
    this.pipelineRegistry.register(pipeline);
    if (this.filePipelineStore) {
      this.filePipelineStore.save(toStoredPipeline(pipeline));
    }
    return pipeline;
  }

  getPipelineRegistry() {
    return this.pipelineRegistry;
  }

  refresh() {
    return true;
  }

  getRuntime() {
    return this.runtime;
  }

  getScheduler() {
    return this.scheduler;
  }

  getCapabilityRegistry() {
    return this.capabilityRegistry;
  }

  getResourceRegistry() {
    return this.resourceRegistry;
  }

  getArtifactStore() {
    return this.artifactStore;
  }

  private buildExampleVersion(): PipelineVersion {
    const schema = new StateSchema({
      name: "DevSchema",
      fields: {
        counter: { type: "number" }
      }
    });

    const graph = new Graph({
      nodes: [
        new Node({ id: "n1", type: "dev.log" }),
        new Node({ id: "n2", type: "dev.increment" }),
        new Node({ id: "n3", type: "dev.log" }),
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ]
    });

    return new PipelineVersion({
      version: 1,
      graph,
      stateSchema: schema
    });
  }

  private buildCancellationVersion(): PipelineVersion {
    const schema = new StateSchema({
      name: "CancelSchema",
      fields: {
        counter: { type: "number" }
      }
    });

    const graph = new Graph({
      nodes: [
        new Node({ id: "c1", type: "dev.log" }),
        new Node({ id: "c2", type: "dev.slow" }),
        new Node({ id: "c3", type: "dev.log" }),
      ],
      edges: [
        { from: "c1", to: "c2" },
        { from: "c2", to: "c3" },
      ]
    });

    return new PipelineVersion({
      version: 1,
      graph,
      stateSchema: schema
    });
  }
}
