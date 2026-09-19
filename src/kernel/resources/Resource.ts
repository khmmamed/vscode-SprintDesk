import { DomainError } from "../DomainError.js";

export type ResourceMetadata = Readonly<Record<string, unknown>>;

export interface ResourceOptions {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly metadata?: ResourceMetadata;
}

export class Resource {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly metadata: ResourceMetadata;

  constructor(options: ResourceOptions) {
    const id = options.id.trim();
    const type = options.type.trim();
    const version = options.version.trim();

    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Resource id must be a non-empty string" });
    }
    if (type.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Resource type must be a non-empty string" });
    }
    if (version.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Resource version must be a non-empty string" });
    }

    this.id = id;
    this.type = type;
    this.version = version;
    this.metadata = Object.freeze({ ...options.metadata });
    Object.freeze(this);
  }
}
