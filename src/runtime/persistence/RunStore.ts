import { DomainError, type NodeFailureKind, type NodeRun, type RunStatus } from "../../kernel/index.js";

export interface StoredNodeAttempt {
  readonly attempt: number;
  readonly status: RunStatus;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly failureKind?: NodeFailureKind;
}

export interface StoredRetryPolicy {
  readonly maxAttempts: number;
  readonly delayMs?: number;
}

export interface StoredNodeRun {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly status: RunStatus;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly error?: string;
  readonly stateVersion?: number;
  readonly failureKind?: NodeFailureKind;
  readonly currentAttempt?: number;
  readonly attempts?: readonly StoredNodeAttempt[];
  readonly retryPolicy?: StoredRetryPolicy;
}

export interface StoredStateSnapshot {
  readonly nodeId: string;
  readonly version: number;
  readonly value: Readonly<Record<string, unknown>>;
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
  readonly states?: readonly StoredStateSnapshot[];
}

export interface RunStore {
  save(run: StoredRun): void;
  get(runId: string): StoredRun | null;
  list(): StoredRun[];
  delete(runId: string): void;
}

const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

const FAILURE_KINDS: readonly NodeFailureKind[] = ["action", "capability", "resource"];

export function toStoredNodeRun(run: NodeRun): StoredNodeRun {
  const stored: MutableNodeRun = {
    nodeId: run.nodeId,
    nodeType: run.nodeType,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    stateVersion: run.stateVersion,
  };
  if (run.failureKind !== undefined) {
    stored.failureKind = run.failureKind;
  }
  const currentAttempt = run.currentAttempt;
  if (currentAttempt !== undefined) {
    stored.currentAttempt = currentAttempt;
  }
  if (run.attempts.length > 0) {
    stored.attempts = run.attempts.map((attempt) => {
      const storedAttempt: MutableNodeAttempt = {
        attempt: attempt.attempt,
        status: attempt.status,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        error: attempt.error,
      };
      if (attempt.failureKind !== undefined) {
        storedAttempt.failureKind = attempt.failureKind;
      }
      return storedAttempt;
    });
  }
  if (run.retryPolicy !== undefined) {
    stored.retryPolicy = {
      maxAttempts: run.retryPolicy.maxAttempts,
      ...(run.retryPolicy.delayMs !== undefined ? { delayMs: run.retryPolicy.delayMs } : {}),
    };
  }
  return stored;
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
  if (run.states !== undefined) {
    if (!Array.isArray(run.states)) {
      throw malformed("states must be an array");
    }
    stored.states = run.states.map(parseStoredStateSnapshot);
  }
  return stored;
}

function parseStoredStateSnapshot(value: unknown): StoredStateSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a state snapshot object");
  }
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.nodeId !== "string" || snapshot.nodeId.trim().length === 0) {
    throw malformed("state snapshot nodeId must be a non-empty string");
  }
  if (typeof snapshot.version !== "number" || !Number.isInteger(snapshot.version) || snapshot.version < 1) {
    throw malformed("state snapshot version must be a positive integer");
  }
  if (typeof snapshot.value !== "object" || snapshot.value === null || Array.isArray(snapshot.value)) {
    throw malformed("state snapshot value must be an object");
  }
  return { nodeId: snapshot.nodeId, version: snapshot.version, value: snapshot.value as Readonly<Record<string, unknown>> };
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
  if (node.failureKind !== undefined) {
    parsedFailureKind(node.failureKind, "node.run");
    stored.failureKind = node.failureKind as NodeFailureKind;
  }
  if (node.currentAttempt !== undefined) {
    if (typeof node.currentAttempt !== "number" || !Number.isInteger(node.currentAttempt) || node.currentAttempt <= 0) {
      throw malformed("node.run currentAttempt must be a positive integer");
    }
    stored.currentAttempt = node.currentAttempt;
  }
  if (node.attempts !== undefined) {
    if (!Array.isArray(node.attempts)) {
      throw malformed("node.run attempts must be an array");
    }
    stored.attempts = node.attempts.map(parseStoredNodeAttempt);
  }
  if (node.retryPolicy !== undefined) {
    stored.retryPolicy = parseStoredRetryPolicy(node.retryPolicy);
  }
  return stored;
}

function parseStoredNodeAttempt(value: unknown): StoredNodeAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected an attempt object");
  }
  const attempt = value as Record<string, unknown>;
  if (typeof attempt.attempt !== "number" || !Number.isInteger(attempt.attempt) || attempt.attempt <= 0) {
    throw malformed("node.run attempt.attempt must be a positive integer");
  }
  if (typeof attempt.startedAt !== "number" || !Number.isFinite(attempt.startedAt)) {
    throw malformed("node.run attempt.startedAt must be a finite number");
  }
  if (typeof attempt.status !== "string" || !RUN_STATUSES.includes(attempt.status as RunStatus)) {
    throw malformed(`node.run attempt.status must be one of ${RUN_STATUSES.join(", ")}`);
  }
  const stored: MutableNodeAttempt = {
    attempt: attempt.attempt,
    status: attempt.status as RunStatus,
    startedAt: attempt.startedAt,
  };
  if (attempt.finishedAt !== undefined) {
    if (typeof attempt.finishedAt !== "number" || !Number.isFinite(attempt.finishedAt)) {
      throw malformed("node.run attempt.finishedAt must be a finite number");
    }
    stored.finishedAt = attempt.finishedAt;
  }
  if (attempt.error !== undefined) {
    if (typeof attempt.error !== "string") {
      throw malformed("node.run attempt.error must be a string");
    }
    stored.error = attempt.error;
  }
  if (attempt.failureKind !== undefined) {
    parsedFailureKind(attempt.failureKind, "node.run attempt");
    stored.failureKind = attempt.failureKind as NodeFailureKind;
  }
  return stored;
}

function parsedFailureKind(value: unknown, subject: string): void {
  if (typeof value !== "string" || !FAILURE_KINDS.includes(value as NodeFailureKind)) {
    throw malformed(`${subject}.failureKind must be one of ${FAILURE_KINDS.join(", ")}`);
  }
}

function parseStoredRetryPolicy(value: unknown): StoredRetryPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("node.run retryPolicy must be an object");
  }
  const policy = value as Record<string, unknown>;
  if (typeof policy.maxAttempts !== "number" || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw malformed("node.run retryPolicy.maxAttempts must be an integer >= 1");
  }
  const stored: MutableRetryPolicy = { maxAttempts: policy.maxAttempts };
  if (policy.delayMs !== undefined) {
    if (typeof policy.delayMs !== "number" || !Number.isFinite(policy.delayMs) || policy.delayMs < 0) {
      throw malformed("node.run retryPolicy.delayMs must be a finite number >= 0");
    }
    stored.delayMs = policy.delayMs;
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
  failureKind?: NodeFailureKind;
  currentAttempt?: number;
  attempts?: StoredNodeAttempt[];
  retryPolicy?: StoredRetryPolicy;
};

type MutableNodeAttempt = {
  attempt: number;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  failureKind?: NodeFailureKind;
};

type MutableRetryPolicy = {
  maxAttempts: number;
  delayMs?: number;
};

type MutableRun = {
  id: string;
  status: RunStatus;
  states?: readonly StoredStateSnapshot[];
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