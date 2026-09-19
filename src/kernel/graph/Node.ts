import { DomainError } from "../DomainError.js";
import type { ResourceReference } from "../resources/ResourceReference.js";
import { RetryPolicy, type RetryPolicyOptions } from "./RetryPolicy.js";

export type NodeMetadata = Readonly<Record<string, unknown>>;

export interface NodeOptions {
  readonly id: string;
  readonly type: string;
  readonly version?: number;
  readonly metadata?: NodeMetadata;
  readonly capabilityId?: string;
  readonly capabilityVersion?: number;
  readonly resourceReferences?: readonly ResourceReference[];
  readonly retryPolicy?: RetryPolicy | RetryPolicyOptions;
}

export class Node {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata: NodeMetadata;
  readonly capabilityId?: string;
  readonly capabilityVersion?: number;
  readonly resourceReferences: readonly ResourceReference[];
  readonly retryPolicy?: RetryPolicy;

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
    if (options.capabilityVersion !== undefined) {
      if (typeof options.capabilityVersion !== "number" || !Number.isInteger(options.capabilityVersion) || options.capabilityVersion < 1) {
        throw new DomainError({ code: "INVALID_INPUT", message: "Node capabilityVersion must be a positive integer when provided" });
      }
      this.capabilityVersion = options.capabilityVersion;
    }
    if (options.retryPolicy !== undefined) {
      if (options.retryPolicy instanceof RetryPolicy) {
        this.retryPolicy = options.retryPolicy;
      } else {
        this.retryPolicy = new RetryPolicy(options.retryPolicy);
      }
    }
    if (options.resourceReferences !== undefined && !Array.isArray(options.resourceReferences)) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Node resourceReferences must be an array" });
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
  const normalized: { resourceId: string; version?: string } = { resourceId };
  if (reference.version !== undefined) {
    if (typeof reference.version !== "string") {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: `Node "${nodeId}" resource reference version must be a string`,
      });
    }
    const version = reference.version.trim();
    if (version.length === 0) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: `Node "${nodeId}" resource reference version must be a non-empty string`,
      });
    }
    normalized.version = version;
  }
  return Object.freeze(normalized);
}