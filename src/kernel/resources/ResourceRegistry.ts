import { Resource } from "./Resource.js";
import { DomainError } from "../DomainError.js";

export class ResourceRegistry {
  private readonly resources = new Map<string, Resource>();

  register(resource: Resource): void {
    if (this.resources.has(resource.id)) {
      throw new DomainError({
        code: "DUPLICATE_ID",
        message: `Resource with id "${resource.id}" is already registered`,
      });
    }
    this.resources.set(resource.id, resource);
  }

  get(id: string): Resource {
    const resource = this.resources.get(id);
    if (!resource) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `Resource with id "${id}" not found`,
      });
    }
    return resource;
  }

  has(id: string): boolean {
    return this.resources.has(id);
  }

  list(): readonly Resource[] {
    return Array.from(this.resources.values());
  }

  remove(id: string): boolean {
    return this.resources.delete(id);
  }
}
