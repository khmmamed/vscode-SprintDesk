import { ResourceRegistry, type Resource, type ResourceReference } from "../kernel/index.js";
import type { ResourceResolver } from "./ResourceResolver.js";

export class RegistryResourceResolver implements ResourceResolver {
  private readonly registry: ResourceRegistry;

  constructor(registry: ResourceRegistry) {
    this.registry = registry;
    Object.freeze(this);
  }

  resolve(reference: ResourceReference): Resource {
    return this.registry.get(reference.resourceId);
  }
}