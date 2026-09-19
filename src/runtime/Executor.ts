import {
  CapabilityHandlerRegistry,
  CapabilityRegistry,
  DomainError,
  EventBus,
  Execution,
  PipelineVersion,
  State,
  type Capability,
  type CapabilityHandler,
  type EventPayload,
  type Node,
  type Resource,
} from "../kernel/index.js";
import { createArtifactService, type ArtifactService } from "./ArtifactService.js";
import type { ResourceResolver, ResolvedResources } from "./ResourceResolver.js";
import type { Artifact, ArtifactStore } from "./persistence/ArtifactStore.js";

export class ExecutionCancelledError extends Error {
  constructor(message = "Execution cancelled") {
    super(message);
    this.name = "ExecutionCancelledError";
  }
}

export interface NodeInput {
  readonly node: Node;
  readonly state: State;
  readonly signal: AbortSignal;
  readonly artifacts: ArtifactService;
}

export type NodeOutput = State;

export interface NodeAction {
  readonly type: string;
  readonly run: (input: NodeInput) => NodeOutput | Promise<NodeOutput>;
}

export interface CapabilityNodeInput {
  readonly node: Node;
  readonly state: State;
  readonly signal: AbortSignal;
  readonly artifacts: ArtifactService;
  readonly resources: ResolvedResources;
}

export interface CapabilityExecutionContext {
  readonly executionId: string;
  readonly version: PipelineVersion;
}

export interface ExecutorOptions {
  readonly actions?: readonly NodeAction[];
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly capabilityHandlerRegistry?: CapabilityHandlerRegistry;
  readonly resourceResolver?: ResourceResolver;
  readonly artifactStore?: ArtifactStore;
}

export interface ExecuteOptions {
  readonly id?: string;
  readonly initialState?: State;
  readonly eventBus?: EventBus;
  readonly signal?: AbortSignal;
}

export class Executor {
  readonly actions: ReadonlyMap<string, NodeAction>;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly capabilityHandlerRegistry?: CapabilityHandlerRegistry;
  readonly resourceResolver?: ResourceResolver;
  readonly artifactStore?: ArtifactStore;

  constructor(options: ExecutorOptions = {}) {
    const actions = new Map<string, NodeAction>();
    for (const action of options.actions ?? []) {
      addAction(actions, action);
    }
    this.actions = actions;
    this.capabilityRegistry = options.capabilityRegistry;
    this.capabilityHandlerRegistry = options.capabilityHandlerRegistry;
    this.resourceResolver = options.resourceResolver;
    this.artifactStore = options.artifactStore;
    Object.freeze(this);
  }

  register(action: NodeAction): Executor {
    return new Executor({
      actions: [...this.actions.values(), action],
      capabilityRegistry: this.capabilityRegistry,
      capabilityHandlerRegistry: this.capabilityHandlerRegistry,
      resourceResolver: this.resourceResolver,
      artifactStore: this.artifactStore,
    });
  }

  async execute(version: PipelineVersion, options: ExecuteOptions = {}): Promise<Execution> {
    const schema = version.stateSchema;
    const initialState = options.initialState ?? new State({ schema, value: {} });
    if (initialState.schema !== schema) {
      throw new DomainError({
        code: "SCHEMA_VIOLATION",
        message: "InitialState schema does not match the PipelineVersion state schema",
      });
    }

    const eventBus = options.eventBus;
    const id = options.id ?? `run-${nextSequence()}`;
    const signal = options.signal ?? new AbortController().signal;
    const order = version.graph.topologicalOrder();

    let execution = new Execution({ id, version, initialState });
    const started = execution.run.start(startTime());
    execution = execution.withRun(started);
    emit(eventBus, "execution.run.started", { executionId: id, status: started.status });

    try {
      const finalState = await this.runGraph(order, initialState, { eventBus, executionId: id, signal, version });
      const finished = execution.run.succeed({ finalState: finalState as unknown as Readonly<Record<string, unknown>> }, finishTime());
      execution = execution.withRun(finished);
      emit(eventBus, "execution.run.finished", { executionId: id, status: finished.status });
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        const cancelled = execution.run.cancel(finishTime());
        execution = execution.withRun(cancelled);
        emit(eventBus, "execution.run.cancelled", { executionId: id, status: cancelled.status });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const failed = execution.run.fail(message, finishTime());
        execution = execution.withRun(failed);
        emit(eventBus, "execution.run.failed", { executionId: id, status: failed.status, error: message });
      }
    }

    return execution;
  }

  private async runGraph(
    order: readonly Node[],
    initialState: State,
    ctx: {
      readonly eventBus?: EventBus;
      readonly executionId: string;
      readonly signal: AbortSignal;
      readonly version: PipelineVersion;
    }
  ): Promise<State> {
    let state = initialState;
    throwIfAborted(ctx.signal);
    for (const node of order) {
      emit(ctx.eventBus, "execution.node.started", {
        executionId: ctx.executionId,
        nodeId: node.id,
        nodeType: node.type,
      });
      const { output, artifacts } = await this.runNode(node, state, ctx);
      throwIfAborted(ctx.signal);
      if (output.schema !== state.schema) {
        throw new DomainError({
          code: "SCHEMA_VIOLATION",
          message: `Node "${node.id}" returned a State with an incompatible schema`,
          details: { nodeId: node.id },
        });
      }
      state = output;
      this.commitArtifacts(artifacts);
      emit(ctx.eventBus, "execution.node.finished", {
        executionId: ctx.executionId,
        nodeId: node.id,
        stateVersion: state.version,
      });
    }
    return state;
  }

  private async runNode(
    node: Node,
    state: State,
    ctx: ExecutorGraphContext
  ): Promise<{ readonly output: State; readonly artifacts: readonly Artifact[] }> {
    const pending: Artifact[] = [];
    const artifacts = createArtifactService((artifact) => pending.push(artifact));
    if (node.capabilityId === undefined) {
      if (node.resourceReferences.length > 0) {
        throw new DomainError({
          code: "INVALID_INPUT",
          message: `Node "${node.id}" declares resource references but is not a capability node`,
          details: { nodeId: node.id },
        });
      }
      const action = this.actions.get(node.type);
      if (!action) {
        throw new DomainError({
          code: "INVALID_INPUT",
          message: `No action registered for node type "${node.type}"`,
          details: { nodeId: node.id },
        });
      }
      const output = await action.run({ node, state, signal: ctx.signal, artifacts });
      return { output, artifacts: pending };
    }
    const capability = this.resolveCapability(node);
    const handler = this.resolveHandler(node, capability);
    const resources = await this.resolveResources(node, ctx);
    const output = await handler.run(
      { node, state, signal: ctx.signal, artifacts, resources },
      { executionId: ctx.executionId, version: ctx.version }
    );
    return { output, artifacts: pending };
  }

  private async resolveResources(node: Node, ctx: ExecutorGraphContext): Promise<ResolvedResources> {
    if (node.resourceReferences.length === 0) {
      return {};
    }
    if (!this.resourceResolver) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `No resource resolver configured; cannot resolve resource references for node "${node.id}"`,
        details: { nodeId: node.id },
      });
    }
    const resolved: Record<string, Resource> = {};
    for (const reference of node.resourceReferences) {
      throwIfAborted(ctx.signal);
      if (resolved[reference.resourceId] !== undefined) {
        continue;
      }
      const resource = await this.resourceResolver.resolve(reference);
      if (resource.id !== reference.resourceId) {
        throw new DomainError({
          code: "UNRESOLVED_REFERENCE",
          message: `Resource resolver did not resolve reference "${reference.resourceId}" for node "${node.id}"`,
          details: { nodeId: node.id, resourceId: reference.resourceId },
        });
      }
      resolved[reference.resourceId] = resource;
    }
    throwIfAborted(ctx.signal);
    return resolved;
  }

  private commitArtifacts(artifacts: readonly Artifact[]): void {
    if (this.artifactStore === undefined || artifacts.length === 0) {
      return;
    }
    for (const artifact of artifacts) {
      this.artifactStore.save(artifact);
    }
  }

  private resolveCapability(node: Node): Capability {
    if (!this.capabilityRegistry) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `No capability registry configured; cannot resolve capability id "${node.capabilityId}" for node "${node.id}"`,
        details: { nodeId: node.id, capabilityId: node.capabilityId },
      });
    }
    return this.capabilityRegistry.get(node.capabilityId as string);
  }

  private resolveHandler(node: Node, capability: Capability): CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> {
    if (!this.capabilityHandlerRegistry) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `No capability handler registry configured; cannot resolve capability id "${capability.id}" for node "${node.id}"`,
        details: { nodeId: node.id, capabilityId: capability.id },
      });
    }
    return this.capabilityHandlerRegistry.get<CapabilityExecutionContext, CapabilityNodeInput, State>(capability.id);
  }
}

type ExecutorGraphContext = {
  readonly eventBus?: EventBus;
  readonly executionId: string;
  readonly signal: AbortSignal;
  readonly version: PipelineVersion;
};

function addAction(actions: Map<string, NodeAction>, action: NodeAction): void {
  if (actions.has(action.type)) {
    throw new DomainError({
      code: "DUPLICATE_ID",
      message: `An action is already registered for node type "${action.type}"`,
    });
  }
  actions.set(action.type, action);
}

function emit(eventBus: EventBus | undefined, type: string, payload: EventPayload): void {
  if (eventBus) {
    eventBus.publish(type, payload);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ExecutionCancelledError();
  }
}

let sequence = 0;
function nextSequence(): number {
  sequence += 1;
  return sequence;
}

function startTime(): number {
  return Date.now();
}

function finishTime(): number {
  return Date.now();
}