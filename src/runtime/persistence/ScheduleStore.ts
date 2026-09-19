import {
  DomainError,
  Edge,
  Graph,
  Node,
  PipelineVersion,
  RetryPolicy,
  StateSchema,
  type FieldType,
} from "../../kernel/index.js";
import { Schedule, type ScheduleTrigger } from "../Schedule.js";

export interface StoredResourceReference {
  readonly resourceId: string;
  readonly version?: string;
}

export interface StoredNodeRetryPolicy {
  readonly maxAttempts: number;
  readonly delayMs?: number;
}

export interface StoredNode {
  readonly id: string;
  readonly type: string;
  readonly version?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly capabilityId?: string;
  readonly capabilityVersion?: number;
  readonly resourceReferences?: readonly StoredResourceReference[];
  readonly retryPolicy?: StoredNodeRetryPolicy;
}

export interface StoredEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly condition?: Readonly<Record<string, unknown>>;
}

export interface StoredSchemaField {
  readonly type: FieldType;
  readonly required?: boolean;
  readonly items?: FieldType;
}

export interface StoredStateSchema {
  readonly name: string;
  readonly version?: number;
  readonly fields?: Readonly<Record<string, StoredSchemaField>>;
}

export interface StoredGraph {
  readonly nodes: readonly StoredNode[];
  readonly edges: readonly StoredEdge[];
}

export interface StoredPipelineVersion {
  readonly version: number;
  readonly graph: StoredGraph;
  readonly stateSchema: StoredStateSchema;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StoredSchedule {
  readonly id: string;
  readonly pipelineId: string;
  readonly version?: number;
  readonly trigger: ScheduleTrigger;
  readonly enabled: boolean;
  readonly createdAt: number;
}

export interface ScheduleStore {
  save(schedule: StoredSchedule): void;
  get(scheduleId: string): StoredSchedule | null;
  list(): StoredSchedule[];
  delete(scheduleId: string): void;
}

export function toStoredSchedule(schedule: Schedule): StoredSchedule {
  return {
    id: schedule.id,
    pipelineId: schedule.pipelineId,
    version: schedule.version,
    trigger: schedule.trigger,
    enabled: schedule.enabled,
    createdAt: schedule.createdAt,
  };
}

export function toStoredPipelineVersion(version: PipelineVersion): StoredPipelineVersion {
  return {
    version: version.version,
    graph: {
      nodes: [...version.graph.nodes.values()].map((node) => {
        const storedNode: {
          id: string;
          type: string;
          version?: number;
          metadata?: Readonly<Record<string, unknown>>;
          capabilityId?: string;
          capabilityVersion?: number;
          resourceReferences: readonly StoredResourceReference[];
          retryPolicy?: StoredNodeRetryPolicy;
        } = {
          id: node.id,
          type: node.type,
          version: node.version,
          metadata: node.metadata,
          capabilityId: node.capabilityId,
          resourceReferences: node.resourceReferences.map(({ resourceId, version }) =>
            version === undefined ? { resourceId } : { resourceId, version }
          ),
        };
        if (node.capabilityVersion !== undefined) {
          storedNode.capabilityVersion = node.capabilityVersion;
        }
        if (node.retryPolicy !== undefined) {
          storedNode.retryPolicy = {
            maxAttempts: node.retryPolicy.maxAttempts,
            ...(node.retryPolicy.delayMs !== undefined ? { delayMs: node.retryPolicy.delayMs } : {}),
          };
        }
        return storedNode;
      }),
      edges: version.graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        label: edge.label,
        condition: edge.condition,
      })),
    },
    stateSchema: {
      name: version.stateSchema.name,
      version: version.stateSchema.version,
      fields: version.stateSchema.fields,
    },
    metadata: version.metadata,
  };
}

export function parseStoredSchedule(value: unknown): StoredSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed("expected a schedule object");
  }
  const schedule = value as Record<string, unknown>;
  if (typeof schedule.id !== "string" || schedule.id.trim().length === 0) {
    throw malformed("id must be a non-empty string");
  }
  if (typeof schedule.enabled !== "boolean") {
    throw malformed("enabled must be a boolean");
  }
  if (typeof schedule.createdAt !== "number" || !Number.isFinite(schedule.createdAt)) {
    throw malformed("createdAt must be a finite number");
  }
  if (!isTrigger(schedule.trigger)) {
    throw malformed("trigger.type must be manual, interval, or event");
  }
  if (typeof schedule.pipelineId !== "string" || schedule.pipelineId.trim().length === 0) {
    throw malformed("pipelineId must be a non-empty string");
  }
  if (
    schedule.version !== undefined &&
    (typeof schedule.version !== "number" || !Number.isInteger(schedule.version) || schedule.version <= 0)
  ) {
    throw malformed("version must be a positive integer when provided");
  }
  const stored = value as unknown as StoredSchedule;
  fromStoredSchedule(stored);
  return stored;
}

export function fromStoredSchedule(stored: StoredSchedule): Schedule {
  try {
    return new Schedule({
      id: stored.id,
      pipelineId: stored.pipelineId,
      version: stored.version,
      trigger: stored.trigger,
      enabled: stored.enabled,
      createdAt: stored.createdAt,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw malformed(`schedule "${stored.id}": ${error.message}`);
    }
    throw error;
  }
}

export function fromStoredPipelineVersion(stored: StoredPipelineVersion): PipelineVersion {
  const graph = new Graph({
    nodes: stored.graph.nodes.map(
      (node) =>
        new Node({
          id: node.id,
          type: node.type,
          version: node.version,
          metadata: node.metadata,
          capabilityId: node.capabilityId,
          capabilityVersion: node.capabilityVersion,
          resourceReferences: node.resourceReferences,
          retryPolicy: node.retryPolicy ? new RetryPolicy(node.retryPolicy) : undefined,
        })
    ),
    edges: stored.graph.edges.map(
      (edge) => new Edge({ from: edge.from, to: edge.to, label: edge.label, condition: edge.condition })
    ),
  });
  const stateSchema = new StateSchema({
    name: stored.stateSchema.name,
    version: stored.stateSchema.version,
    fields: stored.stateSchema.fields,
  });
  return new PipelineVersion({
    version: stored.version,
    graph,
    stateSchema,
    metadata: stored.metadata,
  });
}

function isTrigger(value: unknown): value is ScheduleTrigger {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const trigger = value as Record<string, unknown>;
  return trigger.type === "manual" || trigger.type === "interval" || trigger.type === "event";
}

function malformed(message: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed persisted schedule data: ${message}`,
    details: { message },
  });
}