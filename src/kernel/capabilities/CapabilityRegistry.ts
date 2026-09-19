import { Capability } from "./Capability.js";
import { DomainError } from "../DomainError.js";

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      throw new DomainError({
        code: "DUPLICATE_ID",
        message: `Capability with id "${capability.id}" is already registered`,
      });
    }
    this.capabilities.set(capability.id, capability);
  }

  get(id: string): Capability {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `Capability with id "${id}" not found`,
      });
    }
    return capability;
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  list(): readonly Capability[] {
    return Array.from(this.capabilities.values());
  }

  remove(id: string): boolean {
    return this.capabilities.delete(id);
  }
}
