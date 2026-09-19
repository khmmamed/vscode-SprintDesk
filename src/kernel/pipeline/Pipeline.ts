import { DomainError } from "../DomainError.js";
import { PipelineVersion } from "./PipelineVersion.js";

export interface PipelineOptions {
  readonly id: string;
  readonly name: string;
  readonly versions?: readonly PipelineVersion[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class Pipeline {
  readonly id: string;
  readonly name: string;
  readonly versions: readonly PipelineVersion[];
  readonly metadata: Readonly<Record<string, unknown>>;

  constructor(options: PipelineOptions) {
    const id = options.id.trim();
    const name = options.name.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Pipeline id must be a non-empty string" });
    }
    if (name.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Pipeline name must be a non-empty string" });
    }
    const versions = [...(options.versions ?? [])];
    const seen = new Set<number>();
    for (const version of versions) {
      if (seen.has(version.version)) {
        throw new DomainError({
          code: "DUPLICATE_ID",
          message: `Pipeline "${id}" has duplicate version ${version.version}`,
        });
      }
      seen.add(version.version);
    }
    this.id = id;
    this.name = name;
    this.versions = Object.freeze(versions);
    this.metadata = Object.freeze({ ...options.metadata });
    Object.freeze(this);
  }

  latestVersion(): PipelineVersion | undefined {
    if (this.versions.length === 0) {
      return undefined;
    }
    return this.versions.reduce((latest, version) => (version.version > latest.version ? version : latest));
  }

  withVersion(version: PipelineVersion): Pipeline {
    return new Pipeline({
      id: this.id,
      name: this.name,
      versions: [...this.versions, version],
      metadata: this.metadata,
    });
  }
}