import {
  Pipeline,
  Resource,
  ResourceRegistry,
  type ResourceOptions,
  type StateSchemaOptions,
} from "../../kernel/index.js";
import { PlatformError } from "../PlatformError.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export type ResourceAvailability = "available" | "unavailable" | "unknown";

export interface ResourceValidationInfo {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly validatedAt?: number;
}

export interface ResourceCatalogOptions {
  readonly configurationSchema?: StateSchemaOptions;
  readonly availability?: ResourceAvailability;
  readonly validation?: ResourceValidationInfo;
  readonly documentation?: string;
}

export interface ResourceInfo {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly configurationSchema?: StateSchemaOptions;
  readonly availability: ResourceAvailability;
  readonly validation: ResourceValidationInfo;
  readonly documentation?: string;
}

export interface ResourceUsageInfo {
  readonly resourceId: string;
  readonly pipelineId: string;
  readonly pipelineVersion: number;
  readonly nodeId: string;
  readonly version?: string;
}

interface CatalogEntry {
  readonly resource: Resource;
  readonly options: ResourceCatalogOptions;
}

export class ResourceService {
  readonly registry: ResourceRegistry;
  private readonly entries = new Map<string, Map<string, CatalogEntry>>();

  private readonly authorization?: AuthorizationService;

  constructor(registry: ResourceRegistry = new ResourceRegistry(), authorization?: AuthorizationService) {
    this.registry = registry;
    this.authorization = authorization;
    for (const resource of registry.list()) {
      this.record(resource, {});
    }
  }

  register(value: Resource | ResourceOptions, options: ResourceCatalogOptions = {}, actor?: Principal | string): ResourceInfo {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource" });
    const resource = value instanceof Resource ? value : new Resource(value);
    this.registry.register(resource);
    this.record(resource, options);
    return this.toInfo(resource);
  }

  registerVersion(
    value: Resource | ResourceOptions,
    options: ResourceCatalogOptions & { readonly activate?: boolean } = {},
    actor?: Principal | string
  ): ResourceInfo {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource" });
    const resource = value instanceof Resource ? value : new Resource(value);
    if (this.registry.has(resource.id)) {
      if (options.activate) {
        this.registry.remove(resource.id);
        this.registry.register(resource);
      }
    } else {
      this.registry.register(resource);
    }
    this.record(resource, options);
    return this.toInfo(resource);
  }

  activate(id: string, version: string, actor?: Principal | string): ResourceInfo {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource", id });
    const entry = this.requireEntry(id, version);
    if (this.registry.has(id)) {
      this.registry.remove(id);
    }
    this.registry.register(entry.resource);
    return this.toInfo(entry.resource);
  }

  get(id: string, version?: string, actor?: Principal | string): ResourceInfo {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource", id });
    const resource = version === undefined ? this.registry.get(id) : this.requireEntry(id, version).resource;
    return this.toInfo(resource);
  }

  list(actor?: Principal | string): readonly ResourceInfo[] {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource" });
    return this.registry.list().map((resource) => this.toInfo(resource));
  }

  listVersions(id: string): readonly ResourceInfo[] {
    const versions = this.entries.get(id);
    if (!versions) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", `Resource "${id}" has no catalog entries`, { resourceId: id });
    }
    return [...versions.values()].map((entry) => this.toInfo(entry.resource));
  }

  setAvailability(id: string, version: string, availability: ResourceAvailability): ResourceInfo {
    const entry = this.requireEntry(id, version);
    this.record(entry.resource, { ...entry.options, availability });
    return this.toInfo(entry.resource);
  }

  validate(id: string, version?: string): ResourceValidationInfo {
    const resource = version === undefined ? this.get(id) : this.get(id, version);
    const validation: ResourceValidationInfo = { valid: true, errors: [], validatedAt: Date.now() };
    const entry = this.requireEntry(resource.id, resource.version);
    this.record(entry.resource, { ...entry.options, validation });
    return validation;
  }

  usage(resourceId: string, pipelines: readonly Pipeline[]): readonly ResourceUsageInfo[] {
    const usage: ResourceUsageInfo[] = [];
    for (const pipeline of pipelines) {
      for (const version of pipeline.versions) {
        for (const node of version.graph.nodes.values()) {
          for (const reference of node.resourceReferences) {
            if (reference.resourceId === resourceId) {
              usage.push({
                resourceId,
                pipelineId: pipeline.id,
                pipelineVersion: version.version,
                nodeId: node.id,
                version: reference.version,
              });
            }
          }
        }
      }
    }
    return usage;
  }

  remove(id: string, actor?: Principal | string): boolean {
    this.authorization?.assertAllowed(actor, "resource.discover", { type: "resource", id });
    this.entries.delete(id);
    return this.registry.remove(id);
  }

  private record(resource: Resource, options: ResourceCatalogOptions): void {
    let versions = this.entries.get(resource.id);
    if (!versions) {
      versions = new Map();
      this.entries.set(resource.id, versions);
    }
    versions.set(resource.version, { resource, options });
  }

  private requireEntry(id: string, version: string): CatalogEntry {
    const entry = this.entries.get(id)?.get(version);
    if (!entry) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", `Resource "${id}" version "${version}" is not cataloged`, {
        resourceId: id,
        version,
      });
    }
    return entry;
  }

  private toInfo(resource: Resource): ResourceInfo {
    const options = this.entries.get(resource.id)?.get(resource.version)?.options ?? {};
    return {
      id: resource.id,
      type: resource.type,
      version: resource.version,
      metadata: resource.metadata,
      configurationSchema: options.configurationSchema,
      availability: options.availability ?? "unknown",
      validation: options.validation ?? { valid: false, errors: ["Resource has not been validated"] },
      documentation: options.documentation,
    };
  }
}
