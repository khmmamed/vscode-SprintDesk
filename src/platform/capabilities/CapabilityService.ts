import {
  Capability,
  CapabilityRegistry,
  type CapabilityOptions,
} from "../../kernel/index.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export interface CapabilityInfo {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class CapabilityService {
  constructor(
    readonly registry: CapabilityRegistry = new CapabilityRegistry(),
    private readonly authorization?: AuthorizationService
  ) {}

  register(value: Capability | CapabilityOptions, actor?: Principal | string): CapabilityInfo {
    this.authorization?.assertAllowed(actor, "capability.discover", { type: "capability" });
    const capability = value instanceof Capability ? value : new Capability(value);
    this.registry.register(capability);
    return this.toInfo(capability);
  }

  get(id: string, actor?: Principal | string): CapabilityInfo {
    this.authorization?.assertAllowed(actor, "capability.discover", { type: "capability", id });
    return this.toInfo(this.registry.get(id));
  }

  list(actor?: Principal | string): readonly CapabilityInfo[] {
    this.authorization?.assertAllowed(actor, "capability.discover", { type: "capability" });
    return this.registry.list().map((capability) => this.toInfo(capability));
  }

  remove(id: string, actor?: Principal | string): boolean {
    this.authorization?.assertAllowed(actor, "capability.discover", { type: "capability", id });
    return this.registry.remove(id);
  }

  private toInfo(capability: Capability): CapabilityInfo {
    return {
      id: capability.id,
      type: capability.type,
      version: capability.version,
      metadata: capability.metadata,
    };
  }
}