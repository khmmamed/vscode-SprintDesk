import { DomainError } from "../DomainError.js";
import type { ResourceReference } from "../resources/ResourceReference.js";

export type NodeMetadata = Readonly<Record<string, unknown>>;

export interface NodeOptions {
  readonly id: string;
  readonly type: string;
  readonly version?: number;
  readonly metadata?: NodeMetadata;
  readonly capabilityId?: string;
  readonly resourceReferences?: readonly ResourceReference[];
}

export class Node {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata: NodeMetadata;
  readonly capabilityId?: string;
  readonly resourceReferences: readonly ResourceReference[];

  constructor(options: NodeOptions) {
    const id = options.id.trim();
    const type = options.type.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Node id must be a non-empty string" });
    }
    if (type.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Node type must be a non-empty string" });
    }
    if (options.capabilityId !== undefined) {
      if (typeof options.capabilityId !== "string") {
        throw new DomainError({ code: "INVALID_INPUT", message: "Node capabilityId must be a string" });
      }
      const capabilityId = options.capabilityId.trim();
      if (capabilityId.length === 0) {
        throw new DomainError({ code: "INVALID_INPUT", message: "Node capabilityId must be a non-empty string" });
      }
      this.capabilityId = capabilityId;
    }
    this.id = id;
    this.type = type;
    this.version = options.version ?? 1;
    this.metadata = Object.freeze({ ...options.metadata });
    this.resourceReferences = Object.freeze(
      (options.resourceReferences ?? []).map((reference) => normalizeResourceReference(id, reference))
    );
    Object.freeze(this);
  }
}

function normalizeResourceReference(nodeId: string, reference: ResourceReference): ResourceReference {
  if (reference === null || typeof reference !== "object" || typeof reference.resourceId !== "string") {
    throw new DomainError({
      code: "INVALID_INPUT",
      message: `Node "${nodeId}" resource reference resourceId must be a string`,
    });
  }
  const resourceId = reference.resourceId.trim();
  if (resourceId.length === 0) {
    throw new DomainError({
      code: "INVALID_INPUT",
      message: `Node "${nodeId}" resource reference resourceId must be a non-empty string`,
    });
  }
  return Object.freeze({ resourceId });
}