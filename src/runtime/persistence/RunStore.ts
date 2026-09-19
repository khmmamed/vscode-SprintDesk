import { DomainError, type NodeRun, type RunStatus } from "../../kernel/index.js";

export interface StoredNodeRun {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly status: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly stateVersion?: number;
}

export interface StoredRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly pipelineId?: string;
  readonly pipelineVersion?: number;
  readonly nodes?: readonly StoredNodeRun[];
}

export interface RunStore {
  save(run: StoredRun): void;
  get(runId: string): StoredRun | null;
  list(): StoredRun[];
  delete(runId: string): void;
}

const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

export function toStoredNodeRun(run: NodeRun): StoredNodeRun {
  return {
    nodeId: run.nodeId,
    nodeType: run.nodeType,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    stateVersion: run.stateVersion,
  };
}

export function parseStoredRun(value: unknown): StoredRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a run object");
  }
  const run = value as Record<string, unknown>;
  if (typeof run.id !== "string" || run.id.trim().length === 0) {
    throw malformed("id must be a non-empty string");
  }
  if (typeof run.status !== "string" || !RUN_STATUSES.includes(run.status as RunStatus)) {
    throw malformed(`status must be one of ${RUN_STATUSES.join(", ")}`);
  }
  const stored: MutableRun = { id: run.id, status: run.status as RunStatus };
  if (run.startedAt !== undefined) {
    if (typeof run.startedAt !== "number" || !Number.isFinite(run.startedAt)) {
      throw malformed("startedAt must be a finite number");
    }
    stored.startedAt = run.startedAt;
  }
  if (run.finishedAt !== undefined) {
    if (typeof run.finishedAt !== "number" || !Number.isFinite(run.finishedAt)) {
      throw malformed("finishedAt must be a finite number");
    }
    stored.finishedAt = run.finishedAt;
  }
  if (run.error !== undefined) {
    if (typeof run.error !== "string") {
      throw malformed("error must be a string");
    }
    stored.error = run.error;
  }
  if (run.result !== undefined) {
    if (typeof run.result !== "object" || run.result === null || Array.isArray(run.result)) {
      throw malformed("result must be an object");
    }
    stored.result = run.result as StoredRun["result"];
  }
  if (run.pipelineId !== undefined) {
    if (typeof run.pipelineId !== "string" || run.pipelineId.trim().length === 0) {
      throw malformed("pipelineId must be a non-empty string");
    }
    stored.pipelineId = run.pipelineId;
  }
  if (run.pipelineVersion !== undefined) {
    if (typeof run.pipelineVersion !== "number" || !Number.isInteger(run.pipelineVersion) || run.pipelineVersion <= 0) {
      throw malformed("pipelineVersion must be a positive integer");
    }
    stored.pipelineVersion = run.pipelineVersion;
  }
  if (run.nodes !== undefined) {
    if (!Array.isArray(run.nodes)) {
      throw malformed("nodes must be an array");
    }
    stored.nodes = run.nodes.map(parseStoredNodeRun);
  }
  return stored;
}

function parseStoredNodeRun(value: unknown): StoredNodeRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a node-run object");
  }
  const node = value as Record<string, unknown>;
  if (typeof node.nodeId !== "string" || node.nodeId.trim().length === 0) {
    throw malformed("node.run nodeId must be a non-empty string");
  }
  if (typeof node.nodeType !== "string" || node.nodeType.trim().length === 0) {
    throw malformed("node.run nodeType must be a non-empty string");
  }
  if (typeof node.status !== "string" || !RUN_STATUSES.includes(node.status as RunStatus)) {
    throw malformed(`node.run status must be one of ${RUN_STATUSES.join(", ")}`);
  }
  const stored: MutableNodeRun = { nodeId: node.nodeId, nodeType: node.nodeType, status: node.status as RunStatus };
  if (node.startedAt !== undefined) {
    if (typeof node.startedAt !== "number" || !Number.isFinite(node.startedAt)) {
      throw malformed("node.run startedAt must be a finite number");
    }
    stored.startedAt = node.startedAt;
  }
  if (node.finishedAt !== undefined) {
    if (typeof node.finishedAt !== "number" || !Number.isFinite(node.finishedAt)) {
      throw malformed("node.run finishedAt must be a finite number");
    }
    stored.finishedAt = node.finishedAt;
  }
  if (node.error !== undefined) {
    if (typeof node.error !== "string") {
      throw malformed("node.run error must be a string");
    }
    stored.error = node.error;
  }
  if (node.stateVersion !== undefined) {
    if (typeof node.stateVersion !== "number" || !Number.isInteger(node.stateVersion) || node.stateVersion <= 0) {
      throw malformed("node.run stateVersion must be a positive integer");
    }
    stored.stateVersion = node.stateVersion;
  }
  return stored;
}

type MutableNodeRun = {
  nodeId: string;
  nodeType: string;
  status: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  stateVersion?: number;
};

type MutableRun = {
  id: string;
  status: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: Readonly<Record<string, unknown>>;
  pipelineId?: string;
  pipelineVersion?: number;
  nodes?: StoredNodeRun[];
};

function malformed(message: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed persisted run data: ${message}`,
    details: { message },
  });
}