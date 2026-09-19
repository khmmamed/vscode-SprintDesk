import { DomainError } from "../DomainError.js";
import { Pipeline } from "../pipeline/Pipeline.js";
import { PipelineVersion } from "../pipeline/PipelineVersion.js";
import { State } from "../state/State.js";
import { PipelineRun, type RunStatus } from "./PipelineRun.js";
import { NodeRun } from "./NodeRun.js";

export interface ExecutionOptions {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly initialState: State;
  readonly pipeline?: Pipeline;
  readonly run?: PipelineRun;
  readonly nodes?: ReadonlyMap<string, NodeRun>;
  readonly stateHistory?: ReadonlyMap<string, State>;
}

export class Execution {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly initialState: State;
  readonly run: PipelineRun;
  readonly pipeline?: Pipeline;
  readonly nodes: ReadonlyMap<string, NodeRun>;
  readonly stateHistory: ReadonlyMap<string, State>;

  constructor(options: ExecutionOptions) {
    const id = options.id.trim();
    if (id.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Execution id must be a non-empty string" });
    }
    this.id = id;
    this.version = options.version;
    this.initialState = options.initialState;
    this.run = options.run ?? new PipelineRun({ id: `${id}:run` });
    this.pipeline = options.pipeline;
    this.nodes = options.nodes ?? frozenMap();
    this.stateHistory = options.stateHistory ?? frozenMap<State>();
    Object.freeze(this);
  }

  get status(): RunStatus {
    return this.run.status;
  }

  withRun(run: PipelineRun): Execution {
    return new Execution({
      id: this.id,
      pipeline: this.pipeline,
      version: this.version,
      initialState: this.initialState,
      run,
      nodes: this.nodes,
      stateHistory: this.stateHistory,
    });
  }

  withNodeRun(nodeRun: NodeRun): Execution {
    const nodes = new Map(this.nodes);
    nodes.set(nodeRun.nodeId, nodeRun);
    return new Execution({
      id: this.id,
      pipeline: this.pipeline,
      version: this.version,
      initialState: this.initialState,
      run: this.run,
      nodes: Object.freeze(nodes),
      stateHistory: this.stateHistory,
    });
  }

  withStateSnapshot(nodeId: string, state: State): Execution {
    const history = new Map(this.stateHistory);
    history.set(nodeId, state);
    return new Execution({
      id: this.id,
      pipeline: this.pipeline,
      version: this.version,
      initialState: this.initialState,
      run: this.run,
      nodes: this.nodes,
      stateHistory: Object.freeze(history),
    });
  }
}

function frozenMap<T>(): ReadonlyMap<string, T> {
  return Object.freeze(new Map<string, T>());
}