import { DomainError } from "../../kernel/index.js";

export type ArtifactRef =
  | { readonly kind: "reference"; readonly ref: string }
  | { readonly kind: "content"; readonly content: unknown };

export interface ArtifactLineage {
  readonly executionId: string;
  readonly pipelineId?: string;
  readonly pipelineVersion?: number;
  readonly nodeId: string;
  readonly attempt: number;
}

export interface Artifact {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly ref: ArtifactRef;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt?: number;
  readonly lineage?: ArtifactLineage;
}

export interface ArtifactStore {
  save(artifact: Artifact): void;
  get(artifactId: string): Artifact | null;
  list(): Artifact[];
  delete(artifactId: string): void;
}

export function parseArtifact(value: unknown): Artifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected an artifact object");
  }
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.id !== "string" || artifact.id.trim().length === 0) {
    throw malformed("id must be a non-empty string");
  }
  if (typeof artifact.type !== "string" || artifact.type.trim().length === 0) {
    throw malformed("type must be a non-empty string");
  }
  if (typeof artifact.name !== "string" || artifact.name.trim().length === 0) {
    throw malformed("name must be a non-empty string");
  }
  const stored: MutableArtifact = {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    ref: parseRef(artifact.ref),
  };
  if (artifact.metadata !== undefined) {
    if (typeof artifact.metadata !== "object" || artifact.metadata === null || Array.isArray(artifact.metadata)) {
      throw malformed("metadata must be an object");
    }
    stored.metadata = artifact.metadata as Artifact["metadata"];
  }
  if (artifact.createdAt !== undefined) {
    if (typeof artifact.createdAt !== "number" || !Number.isFinite(artifact.createdAt)) {
      throw malformed("createdAt must be a finite number");
    }
    stored.createdAt = artifact.createdAt;
  }
  if (artifact.lineage !== undefined) {
    stored.lineage = parseLineage(artifact.lineage);
  }
  return stored;
}

type MutableArtifact = {
  id: string;
  type: string;
  name: string;
  ref: ArtifactRef;
  metadata?: Readonly<Record<string, unknown>>;
  createdAt?: number;
  lineage?: ArtifactLineage;
};

function parseLineage(value: unknown): ArtifactLineage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("lineage must be an object");
  }
  const lineage = value as Record<string, unknown>;
  if (typeof lineage.executionId !== "string" || lineage.executionId.trim().length === 0) {
    throw malformed("lineage.executionId must be a non-empty string");
  }
  if (typeof lineage.nodeId !== "string" || lineage.nodeId.trim().length === 0) {
    throw malformed("lineage.nodeId must be a non-empty string");
  }
  if (typeof lineage.attempt !== "number" || !Number.isInteger(lineage.attempt) || lineage.attempt < 1) {
    throw malformed("lineage.attempt must be a positive integer");
  }
  if (lineage.pipelineId !== undefined && (typeof lineage.pipelineId !== "string" || lineage.pipelineId.trim().length === 0)) {
    throw malformed("lineage.pipelineId must be a non-empty string");
  }
  if (lineage.pipelineVersion !== undefined && (typeof lineage.pipelineVersion !== "number" || !Number.isInteger(lineage.pipelineVersion) || lineage.pipelineVersion < 1)) {
    throw malformed("lineage.pipelineVersion must be a positive integer");
  }
  return {
    executionId: lineage.executionId,
    nodeId: lineage.nodeId,
    attempt: lineage.attempt,
    ...(lineage.pipelineId === undefined ? {} : { pipelineId: lineage.pipelineId }),
    ...(lineage.pipelineVersion === undefined ? {} : { pipelineVersion: lineage.pipelineVersion }),
  };
}

function parseRef(value: unknown): ArtifactRef {
  if (typeof value !== "object" || value === null) {
    throw malformed("ref must be an object");
  }
  const ref = value as Record<string, unknown>;
  if (ref.kind === "reference") {
    if (typeof ref.ref !== "string" || ref.ref.trim().length === 0) {
      throw malformed("reference refs must have a non-empty ref string");
    }
    return { kind: "reference", ref: ref.ref };
  }
  if (ref.kind === "content") {
    if (ref.content === undefined) {
      throw malformed("content refs must carry content");
    }
    return { kind: "content", content: ref.content };
  }
  throw malformed('ref.kind must be "reference" or "content"');
}

function malformed(message: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed artifact data: ${message}`,
    details: { message },
  });
}