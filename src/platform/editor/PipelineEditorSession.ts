import type { PipelineVersion } from "../../kernel/index.js";
import type { CapabilityInfo } from "../capabilities/CapabilityService.js";
import type { ResourceInfo } from "../resources/ResourceService.js";
import { PlatformError } from "../PlatformError.js";
import { PipelineAuthoringService } from "../pipelines/PipelineAuthoringService.js";
import { PipelineService, type PipelineVersionLifecycle } from "../pipelines/PipelineService.js";
import { PipelineEditorState } from "./PipelineEditorState.js";

export interface PipelineEditorSessionOptions {
  readonly pipelineService: PipelineService;
  readonly authoringService: PipelineAuthoringService;
  readonly pipelineId: string;
  readonly version: number;
  readonly capabilities?: readonly CapabilityInfo[];
  readonly resources?: readonly ResourceInfo[];
}

export class PipelineEditorSession {
  readonly pipelineId: string;
  readonly pipelineService: PipelineService;
  readonly authoringService: PipelineAuthoringService;
  readonly capabilities: readonly CapabilityInfo[];
  readonly resources: readonly ResourceInfo[];
  private currentVersion: number;
  private editorState: PipelineEditorState;

  constructor(options: PipelineEditorSessionOptions) {
    this.pipelineId = options.pipelineId;
    this.pipelineService = options.pipelineService;
    this.authoringService = options.authoringService;
    this.capabilities = options.capabilities ?? [];
    this.resources = options.resources ?? [];
    this.currentVersion = options.version;
    this.editorState = new PipelineEditorState(options.version, this.pipelineService.getVersion(options.pipelineId, options.version));
  }

  get version(): number {
    return this.currentVersion;
  }

  get lifecycle(): PipelineVersionLifecycle {
    return this.pipelineService.lifecycle(this.pipelineId, this.currentVersion);
  }

  get state(): PipelineEditorState {
    return this.editorState;
  }

  save(): PipelineVersion {
    const targetVersion = this.lifecycle === "published" || this.lifecycle === "validated"
      ? this.nextVersion()
      : this.currentVersion;
    const version = this.editorState.toVersion(targetVersion);
    let saved: PipelineVersion;
    try {
      this.pipelineService.getVersion(this.pipelineId, targetVersion);
      saved = this.authoringService.editVersion(this.pipelineId, targetVersion, {
        graph: version.graph,
        stateSchema: version.stateSchema,
        metadata: version.metadata,
      });
    } catch (error) {
      if (!(error instanceof PlatformError) || error.code !== "VERSION_NOT_FOUND") {
        throw error;
      }
      saved = this.authoringService.createVersion(this.pipelineId, version);
    }
    this.currentVersion = targetVersion;
    this.editorState = new PipelineEditorState(targetVersion, saved);
    return saved;
  }

  validate(): PipelineVersion {
    if (this.editorState.snapshot().dirty) {
      this.save();
    }
    return this.pipelineService.validate(this.pipelineId, this.currentVersion);
  }

  publish(): PipelineVersion {
    this.validate();
    return this.pipelineService.publish(this.pipelineId, this.currentVersion);
  }

  private nextVersion(): number {
    return this.pipelineService.latestVersion(this.pipelineId).version + 1;
  }
}