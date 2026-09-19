import {
  CapabilityHandlerRegistry,
  CapabilityRegistry,
  DomainError,
  EventBus,
  Execution,
  NodeRun,
  PipelineRun,
  PipelineVersion,
  RetryPolicy,
  State,
  type Capability,
  type CapabilityHandler,
  type EventPayload,
  type Node,
  type NodeFailureKind,
  type Resource,
} from "../kernel/index.js";
import { createArtifactService, type ArtifactService } from "./ArtifactService.js";
import type { ExecuteOptions } from "./ExecutionBackend.js";
import type { ResourceResolver, ResolvedResources } from "./ResourceResolver.js";
import type { Artifact, ArtifactLineage, ArtifactStore } from "./persistence/ArtifactStore.js";

export type { ExecuteOptions } from "./ExecutionBackend.js";

export type { NodeFailureKind } from "../kernel/index.js";

export class ExecutionCancelledError extends Error {
  constructor(message = "Execution cancelled") {
    super(message);
    this.name = "ExecutionCancelledError";
  }
}

export class NodeExecutionError extends Error {
  readonly kind: NodeFailureKind;
  readonly original: unknown;

  constructor(kind: NodeFailureKind, original: unknown) {
    const message = original instanceof Error ? original.message : String(original);
    super(message);
    this.name = "NodeExecutionError";
    this.kind = kind;
    this.original = original;
    Object.freeze(this);
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

    let execution = new Execution({
      id,
      version,
      initialState,
      run: new PipelineRun({
        id: `${id}:run`,
        pipelineId: options.pipelineId,
        pipelineVersion: options.pipelineVersion,
      }),
    });
    const started = execution.run.start(startTime());
    execution = execution.withRun(started);
    for (const node of order) {
      execution = execution.withNodeRun(new NodeRun({ nodeId: node.id, nodeType: node.type, retryPolicy: node.retryPolicy }));
    }
    emit(eventBus, "execution.run.started", { executionId: id, status: started.status });

    const box: { execution: Execution } = { execution };
    try {
      const finalState = await this.runGraph(order, initialState, {
        eventBus,
        executionId: id,
        pipelineId: options.pipelineId,
        pipelineVersion: options.pipelineVersion ?? version.version,
        signal,
        version,
      }, box);
      execution = box.execution;
      const finished = execution.run.succeed({ finalState: finalState as unknown as Readonly<Record<string, unknown>> }, finishTime());
      execution = execution.withRun(finished);
      emit(eventBus, "execution.run.finished", { executionId: id, status: finished.status });
    } catch (error) {
      execution = box.execution;
      if (error instanceof ExecutionCancelledError) {
        const cancelled = execution.run.cancel(finishTime());
        execution = execution.withRun(cancelled);
        execution = cancelQueuedNodeRuns(execution, finishTime());
        emit(eventBus, "execution.run.cancelled", { executionId: id, status: cancelled.status });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const kind = error instanceof NodeExecutionError ? error.kind : undefined;
        const failed = execution.run.fail(message, finishTime());
        execution = execution.withRun(failed);
        emit(eventBus, "execution.run.failed", {
          executionId: id,
          status: failed.status,
          error: message,
          ...(kind !== undefined ? { kind } : {}),
        });
      }
    }

    return execution;
  }

  private async runGraph(
    order: readonly Node[],
    initialState: State,
    ctx: ExecutorGraphContext,
    box: { execution: Execution }
  ): Promise<State> {
    let state = initialState;
    throwIfAborted(ctx.signal);
    for (const node of order) {
      state = await this.runNodeWithRetries(node, state, ctx, box);
    }
    return state;
  }

  private async runNodeWithRetries(
    node: Node,
    state: State,
    ctx: ExecutorGraphContext,
    box: { execution: Execution }
  ): Promise<State> {
    let execution = box.execution;
    const commit = (): void => {
      box.execution = execution;
    };

    emit(ctx.eventBus, "execution.node.started", {
      executionId: ctx.executionId,
      nodeId: node.id,
      nodeType: node.type,
    });
    execution = execution.withNodeRun(getNodeRun(execution, node.id).start(startTime()));
    commit();

    const policy = node.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const maxAttempts = policy.maxAttempts;
    const retrying = maxAttempts > 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        const delayMs = policy.delayMs ?? 0;
        emit(ctx.eventBus, "execution.node.retry.scheduled", {
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          attempt,
          delayMs,
        });
        await wait(delayMs, ctx.signal);
        execution = execution.withNodeRun(getNodeRun(execution, node.id).start(startTime()));
        commit();
      }
      if (retrying) {
        emit(ctx.eventBus, "execution.node.attempt.started", {
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          attempt,
        });
      }

      let output: State;
      let artifacts: readonly Artifact[];
      try {
        const result = await this.runNode(node, state, ctx);
        output = result.output;
        artifacts = result.artifacts;
      } catch (error) {
        if (error instanceof ExecutionCancelledError) {
          execution = execution.withNodeRun(getNodeRun(execution, node.id).cancel(finishTime()));
          commit();
          emit(ctx.eventBus, "execution.node.cancelled", {
            executionId: ctx.executionId,
            nodeId: node.id,
            nodeType: node.type,
          });
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const kind = error instanceof NodeExecutionError ? error.kind : undefined;
        if (retrying && attempt < maxAttempts) {
          execution = execution.withNodeRun(getNodeRun(execution, node.id).failAttempt(message, finishTime(), kind));
          commit();
          emit(ctx.eventBus, "execution.node.attempt.failed", {
            executionId: ctx.executionId,
            nodeId: node.id,
            nodeType: node.type,
            attempt,
            error: message,
            ...(kind !== undefined ? { kind } : {}),
          });
          continue;
        }
        if (retrying) {
          emit(ctx.eventBus, "execution.node.attempt.failed", {
            executionId: ctx.executionId,
            nodeId: node.id,
            nodeType: node.type,
            attempt,
            error: message,
            ...(kind !== undefined ? { kind } : {}),
          });
        }
        execution = execution.withNodeRun(getNodeRun(execution, node.id).fail(message, finishTime(), kind));
        commit();
        emit(ctx.eventBus, "execution.node.failed", {
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          error: message,
          ...(kind !== undefined ? { kind } : {}),
        });
        throw error;
      }

      throwIfAborted(ctx.signal);
      if (output.schema !== state.schema) {
        const message = `Node "${node.id}" returned a State with an incompatible schema`;
        execution = execution.withNodeRun(getNodeRun(execution, node.id).fail(message, finishTime()));
        commit();
        emit(ctx.eventBus, "execution.node.failed", {
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          error: message,
        });
        throw new DomainError({
          code: "SCHEMA_VIOLATION",
          message,
          details: { nodeId: node.id },
        });
      }

      state = output;
      execution = execution.withNodeRun(getNodeRun(execution, node.id).succeed(state.version, finishTime()));
      execution = execution.withStateSnapshot(node.id, state);
      commit();
      this.commitArtifacts(artifacts, {
        executionId: ctx.executionId,
        pipelineId: ctx.pipelineId,
        pipelineVersion: ctx.pipelineVersion,
        nodeId: node.id,
        attempt: getNodeRun(execution, node.id).currentAttempt ?? attempt,
      });
      emit(ctx.eventBus, "execution.node.finished", {
        executionId: ctx.executionId,
        nodeId: node.id,
        stateVersion: state.version,
      });
      return state;
    }

    throw new DomainError({
      code: "INVALID_INPUT",
      message: `Node "${node.id}" exhausted its attempts without a terminal outcome`,
      details: { nodeId: node.id, maxAttempts },
    });
  }

  private async runNode(
    node: Node,
    state: State,
    ctx: ExecutorGraphContext
  ): Promise<{ readonly output: State; readonly artifacts: readonly Artifact[] }> {
    const pending: Artifact[] = [];
    const artifacts = createArtifactService((artifact) => pending.push(artifact));
    if (node.capabilityId === undefined) {
      return runPlainNode(this, node, state, ctx, artifacts, pending);
    }
    return runCapabilityNode(this, node, state, ctx, artifacts, pending);
  }

  private commitArtifacts(artifacts: readonly Artifact[], lineage: ArtifactLineage): void {
    if (this.artifactStore === undefined || artifacts.length === 0) {
      return;
    }
    for (const artifact of artifacts) {
      this.artifactStore.save(artifact.lineage === undefined ? { ...artifact, lineage } : artifact);
    }
  }
}

async function runPlainNode(
  executor: Executor,
  node: Node,
  state: State,
  ctx: ExecutorGraphContext,
  artifacts: ArtifactService,
  pending: Artifact[]
): Promise<{ readonly output: State; readonly artifacts: readonly Artifact[] }> {
  try {
    if (node.resourceReferences.length > 0) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: `Node "${node.id}" declares resource references but is not a capability node`,
        details: { nodeId: node.id },
      });
    }
    const action = executor.actions.get(node.type);
    if (!action) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: `No action registered for node type "${node.type}"`,
        details: { nodeId: node.id },
      });
    }
    const output = await action.run({ node, state, signal: ctx.signal, artifacts });
    return { output, artifacts: pending };
  } catch (error) {
    rethrowIfCancelled(error);
    throw new NodeExecutionError("action", error);
  }
}

async function runCapabilityNode(
  executor: Executor,
  node: Node,
  state: State,
  ctx: ExecutorGraphContext,
  artifacts: ArtifactService,
  pending: Artifact[]
): Promise<{ readonly output: State; readonly artifacts: readonly Artifact[] }> {
  let capability: Capability;
  let handler: CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State>;
  try {
    capability = resolveCapability(executor, node);
    handler = resolveHandler(executor, node, capability);
  } catch (error) {
    rethrowIfCancelled(error);
    throw new NodeExecutionError("capability", error);
  }
  let resources: ResolvedResources;
  try {
    resources = await resolveResources(executor, node, ctx);
  } catch (error) {
    rethrowIfCancelled(error);
    throw new NodeExecutionError("resource", error);
  }
  try {
    const output = await handler.run(
      { node, state, signal: ctx.signal, artifacts, resources },
      { executionId: ctx.executionId, version: ctx.version }
    );
    return { output, artifacts: pending };
  } catch (error) {
    rethrowIfCancelled(error);
    throw new NodeExecutionError("capability", error);
  }
}

function resolveCapability(executor: Executor, node: Node): Capability {
  if (!executor.capabilityRegistry) {
    throw new DomainError({
      code: "UNRESOLVED_REFERENCE",
      message: `No capability registry configured; cannot resolve capability id "${node.capabilityId}" for node "${node.id}"`,
      details: { nodeId: node.id, capabilityId: node.capabilityId },
    });
  }
  const capability = executor.capabilityRegistry.get(node.capabilityId as string);
  if (node.capabilityVersion !== undefined && capability.version !== node.capabilityVersion) {
    throw new DomainError({
      code: "UNRESOLVED_REFERENCE",
      message: `Capability with id "${capability.id}" is not available at version ${node.capabilityVersion} (registered version ${capability.version})`,
      details: {
        nodeId: node.id,
        capabilityId: capability.id,
        requestedVersion: node.capabilityVersion,
        registeredVersion: capability.version,
      },
    });
  }
  return capability;
}

function resolveHandler(executor: Executor, node: Node, capability: Capability): CapabilityHandler<CapabilityExecutionContext, CapabilityNodeInput, State> {
  if (!executor.capabilityHandlerRegistry) {
    throw new DomainError({
      code: "UNRESOLVED_REFERENCE",
      message: `No capability handler registry configured; cannot resolve capability id "${capability.id}" for node "${node.id}"`,
      details: { nodeId: node.id, capabilityId: capability.id },
    });
  }
  return executor.capabilityHandlerRegistry.get<CapabilityExecutionContext, CapabilityNodeInput, State>(capability.id);
}

async function resolveResources(executor: Executor, node: Node, ctx: ExecutorGraphContext): Promise<ResolvedResources> {
  if (node.resourceReferences.length === 0) {
    return {};
  }
  if (!executor.resourceResolver) {
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
    const resource = await executor.resourceResolver.resolve(reference);
    if (!resource.matches(reference)) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `Resource resolver did not resolve reference "${reference.resourceId}" for node "${node.id}"`,
        details: { nodeId: node.id, resourceId: reference.resourceId, reference },
      });
    }
    resolved[reference.resourceId] = resource;
  }
  throwIfAborted(ctx.signal);
  return resolved;
}

function rethrowIfCancelled(error: unknown): void {
  if (error instanceof ExecutionCancelledError) {
    throw error;
  }
}

type ExecutorGraphContext = {
  readonly eventBus?: EventBus;
  readonly executionId: string;
  readonly pipelineId?: string;
  readonly pipelineVersion?: number;
  readonly signal: AbortSignal;
  readonly version: PipelineVersion;
};

const DEFAULT_RETRY_POLICY = new RetryPolicy({ maxAttempts: 1 });

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

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ExecutionCancelledError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ExecutionCancelledError());
    };
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getNodeRun(execution: Execution, nodeId: string): NodeRun {
  const nodeRun = execution.nodes.get(nodeId);
  if (!nodeRun) {
    throw new DomainError({
      code: "INVALID_INPUT",
      message: `No NodeRun tracked for node "${nodeId}"`,
      details: { nodeId },
    });
  }
  return nodeRun;
}

function cancelQueuedNodeRuns(execution: Execution, now: number): Execution {
  let result = execution;
  for (const nodeRun of execution.nodes.values()) {
    if (nodeRun.status === "queued" || nodeRun.status === "running") {
      result = result.withNodeRun(nodeRun.cancel(now));
    }
  }
  return result;
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