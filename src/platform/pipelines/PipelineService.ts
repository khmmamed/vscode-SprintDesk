import {
  CapabilityRegistry,
  Pipeline,
  PipelineRegistry,
  PipelineVersion,
  ResourceRegistry,
  type PipelineOptions,
  type PipelineVersionOptions,
} from "../../kernel/index.js";
import { PlatformError } from "../PlatformError.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export type PipelineVersionLifecycle = "draft" | "validated" | "published";

export interface PipelineVersionInfo {
  readonly pipelineId: string;
  readonly version: PipelineVersion;
  readonly lifecycle: PipelineVersionLifecycle;
}

export interface PipelineServiceOptions {
  readonly registry?: PipelineRegistry;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly resourceRegistry?: ResourceRegistry;
  readonly authorizationService?: AuthorizationService;
}

export class PipelineService {
  readonly registry: PipelineRegistry;
  private readonly capabilityRegistry?: CapabilityRegistry;
  private readonly resourceRegistry?: ResourceRegistry;
  private readonly authorization?: AuthorizationService;
  private readonly lifecycles = new Map<string, PipelineVersionLifecycle>();

  constructor(options: PipelineServiceOptions = {}) {
    this.registry = options.registry ?? new PipelineRegistry();
    this.capabilityRegistry = options.capabilityRegistry;
    this.resourceRegistry = options.resourceRegistry;
    this.authorization = options.authorizationService;
    for (const pipeline of this.registry.list()) {
      for (const version of pipeline.versions) {
        this.lifecycles.set(this.key(pipeline.id, version.version), "draft");
      }
    }
  }

  create(options: Pipeline | PipelineOptions, actor?: Principal | string): Pipeline {
    this.authorization?.assertAllowed(actor, "pipeline.create", { type: "pipeline" });
    const pipeline = options instanceof Pipeline ? options : new Pipeline(options);
    this.registry.register(pipeline);
    for (const version of pipeline.versions) {
      this.lifecycles.set(this.key(pipeline.id, version.version), "draft");
    }
    return pipeline;
  }

  replace(pipelineId: string, pipeline: Pipeline, actor?: Principal | string): Pipeline {
    this.authorization?.assertAllowed(actor, "pipeline.edit", { type: "pipeline", id: pipelineId });
    if (pipeline.id !== pipelineId) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", "Replacement pipeline id does not match the requested pipeline", {
        pipelineId,
        replacementId: pipeline.id,
      });
    }
    this.get(pipelineId);
    this.registry.remove(pipelineId);
    this.registry.register(pipeline);
    for (const version of pipeline.versions) {
      if (!this.lifecycles.has(this.key(pipelineId, version.version))) {
        this.lifecycles.set(this.key(pipelineId, version.version), "draft");
      }
    }
    return pipeline;
  }

  get(id: string, actor?: Principal | string): Pipeline {
    this.authorization?.assertAllowed(actor, "pipeline.read", { type: "pipeline", id });
    try {
      return this.registry.get(id);
    } catch {
      throw new PlatformError("PIPELINE_NOT_FOUND", `Pipeline with id "${id}" was not found`, { pipelineId: id });
    }
  }

  list(actor?: Principal | string): readonly Pipeline[] {
    this.authorization?.assertAllowed(actor, "pipeline.read", { type: "pipeline" });
    return this.registry.list();
  }

  createVersion(pipelineId: string, options: PipelineVersion | PipelineVersionOptions, actor?: Principal | string): PipelineVersion {
    this.authorization?.assertAllowed(actor, "pipeline.edit", { type: "pipeline", id: pipelineId });
    const pipeline = this.get(pipelineId);
    const version = options instanceof PipelineVersion ? options : new PipelineVersion(options);
    const key = this.key(pipelineId, version.version);
    const existing = pipeline.versions.find((candidate) => candidate.version === version.version);
    if (existing !== undefined && this.lifecycle(pipelineId, version.version) !== "draft") {
      throw new PlatformError(
        "INVALID_PLATFORM_OPERATION",
        `Pipeline version ${version.version} is no longer editable`,
        { pipelineId, version: version.version }
      );
    }
    const versions = existing === undefined
      ? [...pipeline.versions, version]
      : pipeline.versions.map((candidate) => candidate.version === version.version ? version : candidate);
    const replacement = new Pipeline({
      id: pipeline.id,
      name: pipeline.name,
      versions,
      metadata: pipeline.metadata,
    });
    this.registry.remove(pipelineId);
    this.registry.register(replacement);
    this.lifecycles.set(key, "draft");
    return version;
  }

  getVersion(pipelineId: string, version: number): PipelineVersion {
    const pipeline = this.get(pipelineId);
    const result = pipeline.versions.find((candidate) => candidate.version === version);
    if (!result) {
      throw new PlatformError("VERSION_NOT_FOUND", `Pipeline "${pipelineId}" has no version ${version}`, { pipelineId, version });
    }
    return result;
  }

  latestVersion(pipelineId: string): PipelineVersion {
    const version = this.get(pipelineId).latestVersion();
    if (!version) {
      throw new PlatformError("VERSION_NOT_FOUND", `Pipeline "${pipelineId}" has no versions`, { pipelineId });
    }
    return version;
  }

  latestPublishedVersion(pipelineId: string): PipelineVersion {
    const pipeline = this.get(pipelineId);
    const versions = pipeline.versions.filter((version) => this.lifecycle(pipelineId, version.version) === "published");
    const version = versions.reduce<PipelineVersion | undefined>(
      (latest, candidate) => latest === undefined || candidate.version > latest.version ? candidate : latest,
      undefined
    );
    if (!version) {
      throw new PlatformError("VERSION_NOT_PUBLISHED", `Pipeline "${pipelineId}" has no published version`, { pipelineId });
    }
    return version;
  }

  getVersionInfo(pipelineId: string, version: number): PipelineVersionInfo {
    return { pipelineId, version: this.getVersion(pipelineId, version), lifecycle: this.lifecycle(pipelineId, version) };
  }

  validate(pipelineId: string, version: number, actor?: Principal | string): PipelineVersion {
    this.authorization?.assertAllowed(actor, "pipeline.validate", { type: "pipeline", id: pipelineId });
    const candidate = this.getVersion(pipelineId, version);
    const lifecycle = this.lifecycle(pipelineId, version);
    if (lifecycle === "published") {
      return candidate;
    }
    candidate.graph.validate();
    for (const node of candidate.graph.nodes.values()) {
      if (node.capabilityId !== undefined && this.capabilityRegistry) {
        const capability = this.capabilityRegistry.get(node.capabilityId);
        if (node.capabilityVersion !== undefined && capability.version !== node.capabilityVersion) {
          throw new PlatformError("INVALID_PLATFORM_OPERATION", `Capability reference for node "${node.id}" is not compatible`, {
            pipelineId,
            version,
            nodeId: node.id,
          });
        }
      } else if (node.capabilityId !== undefined) {
        throw new PlatformError("INVALID_PLATFORM_OPERATION", "Capability validation requires a capability registry", {
          pipelineId,
          version,
          nodeId: node.id,
        });
      }
      if (this.resourceRegistry) {
        for (const reference of node.resourceReferences) {
          const resource = this.resourceRegistry.get(reference.resourceId);
          if (reference.version !== undefined && resource.version !== reference.version) {
            throw new PlatformError("INVALID_PLATFORM_OPERATION", `Resource reference for node "${node.id}" is not compatible`, {
              pipelineId,
              version,
              nodeId: node.id,
            });
          }
        }
      } else if (node.resourceReferences.length > 0) {
        throw new PlatformError("INVALID_PLATFORM_OPERATION", "Resource validation requires a resource registry", {
          pipelineId,
          version,
          nodeId: node.id,
        });
      }
    }
    this.lifecycles.set(this.key(pipelineId, version), "validated");
    return candidate;
  }

  publish(pipelineId: string, version: number, actor?: Principal | string): PipelineVersion {
    this.authorization?.assertAllowed(actor, "pipeline.publish", { type: "pipeline", id: pipelineId });
    const candidate = this.getVersion(pipelineId, version);
    const lifecycle = this.lifecycle(pipelineId, version);
    if (lifecycle === "draft") {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", "A draft version must be validated before publishing", { pipelineId, version });
    }
    this.lifecycles.set(this.key(pipelineId, version), "published");
    return candidate;
  }

  lifecycle(pipelineId: string, version: number): PipelineVersionLifecycle {
    this.getVersion(pipelineId, version);
    return this.lifecycles.get(this.key(pipelineId, version)) ?? "draft";
  }

  requirePublished(pipelineId: string, version?: number): PipelineVersion {
    const candidate = version === undefined ? this.latestPublishedVersion(pipelineId) : this.getVersion(pipelineId, version);
    if (this.lifecycle(pipelineId, candidate.version) !== "published") {
      throw new PlatformError("VERSION_NOT_PUBLISHED", `Pipeline "${pipelineId}" version ${candidate.version} is not published`, {
        pipelineId,
        version: candidate.version,
      });
    }
    return candidate;
  }

  private key(pipelineId: string, version: number): string {
    return `${pipelineId}:${version}`;
  }
}