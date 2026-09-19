import {
  CapabilityRegistry,
  EventBus,
  PipelineRegistry,
  ResourceRegistry,
} from "../kernel/index.js";
import {
  Dispatcher,
  Executor,
  InProcessExecutionBackend,
  MemoryArtifactStore,
  PipelineEngine,
  RegistryResourceResolver,
  Runtime,
  Scheduler,
  type ArtifactStore,
} from "../runtime/index.js";
import { ArtifactService } from "./artifacts/ArtifactService.js";
import { CapabilityService } from "./capabilities/CapabilityService.js";
import { PlatformError } from "./PlatformError.js";
import { PipelineService } from "./pipelines/PipelineService.js";
import { PipelineAuthoringService } from "./pipelines/PipelineAuthoringService.js";
import { ResourceService } from "./resources/ResourceService.js";
import { RunService } from "./runs/RunService.js";
import { RunControlService } from "./runs/RunControlService.js";
import { DebuggingService } from "./runs/DebuggingService.js";
import { ScheduleService } from "./schedules/ScheduleService.js";
import { PipelineEditorSession } from "./editor/PipelineEditorSession.js";
import { AuthorizationService } from "./policies/AuthorizationService.js";

export interface PlatformOptions {
  readonly pipelineService?: PipelineService;
  readonly runService?: RunService;
  readonly scheduleService?: ScheduleService;
  readonly capabilityService?: CapabilityService;
  readonly resourceService?: ResourceService;
  readonly artifactService?: ArtifactService;
  readonly runtime?: Runtime;
  readonly engine?: PipelineEngine;
  readonly dispatcher?: Dispatcher;
  readonly scheduler?: Scheduler;
  readonly artifactStore?: ArtifactStore;
  readonly eventBus?: EventBus;
  readonly authoringService?: PipelineAuthoringService;
  readonly authorizationService?: AuthorizationService;
}

export class Platform {
  readonly authoringService: PipelineAuthoringService;
  readonly eventBus?: EventBus;
  readonly pipelineService: PipelineService;
  readonly runService: RunService;
  readonly runControlService: RunControlService;
  readonly debuggingService: DebuggingService;
  readonly scheduleService: ScheduleService;
  readonly capabilityService: CapabilityService;
  readonly resourceService: ResourceService;
  readonly artifactService: ArtifactService;
  readonly authorizationService: AuthorizationService;

  constructor(options: PlatformOptions = {}) {
    this.eventBus = options.eventBus;
    this.authorizationService = options.authorizationService ?? new AuthorizationService();
    this.capabilityService = options.capabilityService ?? new CapabilityService(new CapabilityRegistry(), this.authorizationService);
    this.resourceService = options.resourceService ?? new ResourceService(new ResourceRegistry(), this.authorizationService);
    this.artifactService = options.artifactService ?? new ArtifactService(options.artifactStore ?? new MemoryArtifactStore(), this.authorizationService);
    this.pipelineService = options.pipelineService ?? new PipelineService({
      registry: new PipelineRegistry(),
      capabilityRegistry: this.capabilityService.registry,
      resourceRegistry: this.resourceService.registry,
      authorizationService: this.authorizationService,
    });
    this.authoringService = options.authoringService ?? new PipelineAuthoringService({ pipelineService: this.pipelineService });

    const runtime = options.runtime ?? new Runtime({
      backend: new InProcessExecutionBackend(new Executor({
        capabilityRegistry: this.capabilityService.registry,
        resourceResolver: new RegistryResourceResolver(this.resourceService.registry),
        artifactStore: this.artifactService.store,
      })),
      eventBus: options.eventBus,
    });
    const engine = options.engine ?? new PipelineEngine(this.pipelineService.registry, runtime);
    const dispatcher = options.dispatcher ?? new Dispatcher({ engine, runtime });
    const scheduler = options.scheduler ?? new Scheduler({ dispatcher, eventBus: options.eventBus });

    this.runService = options.runService ?? new RunService(this.pipelineService, engine, runtime, this.authorizationService);
    this.runControlService = new RunControlService(this.runService, this.pipelineService, this.artifactService);
    this.debuggingService = new DebuggingService(this.eventBus, this.runControlService, this.artifactService);
    this.scheduleService = options.scheduleService ?? new ScheduleService(scheduler, this.pipelineService, this.authorizationService);
    Object.freeze(this);
  }

  static create(options: PlatformOptions = {}): Platform {
    return new Platform(options);
  }

  can(actor: string, permission: import("./policies/AuthorizationService.js").Permission, resource?: import("./policies/AuthorizationService.js").PolicyResource): boolean {
    return this.authorizationService.decide(actor, permission, resource).allowed;
  }

  openPipelineEditor(pipelineId: string, version: number): PipelineEditorSession {
    return new PipelineEditorSession({
      pipelineService: this.pipelineService,
      authoringService: this.authoringService,
      pipelineId,
      version,
      capabilities: this.capabilityService.list(),
      resources: this.resourceService.list(),
    });
  }

  requirePipeline(id: string): void {
    if (!this.pipelineService.registry.has(id)) {
      throw new PlatformError("PIPELINE_NOT_FOUND", `Pipeline with id "${id}" was not found`, { pipelineId: id });
    }
  }
}