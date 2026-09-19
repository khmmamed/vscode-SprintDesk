import { DomainError } from "../DomainError.js";

export type CapabilityMetadata = Readonly<Record<string, unknown>>;

export interface CapabilityOptions {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata?: CapabilityMetadata;
}

export class Capability {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly metadata: CapabilityMetadata;

  constructor(options: CapabilityOptions) {
    const id = options.id.trim();
    const type = options.type.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Capability id must be a non-empty string" });
    }
    if (type.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Capability type must be a non-empty string" });
    }
    this.id = id;
    this.type = type;
    this.version = options.version;
    this.metadata = Object.freeze({ ...options.metadata });
    Object.freeze(this);
  }

  equals(other: Capability): boolean {
    return this.id === other.id && this.version === other.version;
  }
}
