import {
  DomainError,
  Edge,
  Graph,
  Node,
  PipelineVersion,
  StateSchema,
  type FieldType,
} from "../../kernel/index.js";
import { Schedule, type ScheduleTrigger } from "../Schedule.js";

export interface StoredResourceReference {
  readonly resourceId: string;
}

export interface StoredNode {
  readonly id: string;
  readonly type: string;
  readonly version?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly capabilityId?: string;
  readonly resourceReferences?: readonly StoredResourceReference[];
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
  readonly version: StoredPipelineVersion;
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
    version: {
      version: schedule.version.version,
      graph: {
        nodes: [...schedule.version.graph.nodes.values()].map((node) => ({
          id: node.id,
          type: node.type,
          version: node.version,
          metadata: node.metadata,
          capabilityId: node.capabilityId,
          resourceReferences: node.resourceReferences.map(({ resourceId }) => ({ resourceId })),
        })),
        edges: schedule.version.graph.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          label: edge.label,
          condition: edge.condition,
        })),
      },
      stateSchema: {
        name: schedule.version.stateSchema.name,
        version: schedule.version.stateSchema.version,
        fields: schedule.version.stateSchema.fields,
      },
      metadata: schedule.version.metadata,
    },
    trigger: schedule.trigger,
    enabled: schedule.enabled,
    createdAt: schedule.createdAt,
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
  const version = schedule.version;
  if (typeof version !== "object" || version === null) {
    throw malformed("version must be an object");
  }
  const versionRecord = version as Record<string, unknown>;
  if (typeof versionRecord.version !== "number") {
    throw malformed("version.version must be a number");
  }
  const graph = versionRecord.graph;
  if (typeof graph !== "object" || graph === null) {
    throw malformed("version.graph must be an object");
  }
  const graphRecord = graph as Record<string, unknown>;
  if (!Array.isArray(graphRecord.nodes) || !Array.isArray(graphRecord.edges)) {
    throw malformed("version.graph must have a nodes array and an edges array");
  }
  const stateSchema = versionRecord.stateSchema;
  if (typeof stateSchema !== "object" || stateSchema === null) {
    throw malformed("version.stateSchema must be an object");
  }
  if (typeof (stateSchema as Record<string, unknown>).name !== "string") {
    throw malformed("version.stateSchema.name must be a string");
  }
  const stored = value as unknown as StoredSchedule;
  fromStoredSchedule(stored);
  return stored;
}

export function fromStoredSchedule(stored: StoredSchedule): Schedule {
  try {
    const graph = new Graph({
      nodes: stored.version.graph.nodes.map(
        (node) =>
          new Node({
            id: node.id,
            type: node.type,
            version: node.version,
            metadata: node.metadata,
            capabilityId: node.capabilityId,
            resourceReferences: node.resourceReferences,
          })
      ),
      edges: stored.version.graph.edges.map(
        (edge) => new Edge({ from: edge.from, to: edge.to, label: edge.label, condition: edge.condition })
      ),
    });
    const stateSchema = new StateSchema({
      name: stored.version.stateSchema.name,
      version: stored.version.stateSchema.version,
      fields: stored.version.stateSchema.fields,
    });
    const version = new PipelineVersion({
      version: stored.version.version,
      graph,
      stateSchema,
      metadata: stored.version.metadata,
    });
    return new Schedule({
      id: stored.id,
      version,
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