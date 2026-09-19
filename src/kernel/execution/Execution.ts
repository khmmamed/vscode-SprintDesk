import { DomainError } from "../DomainError.js";
import { Pipeline } from "../pipeline/Pipeline.js";
import { PipelineVersion } from "../pipeline/PipelineVersion.js";
import { State } from "../state/State.js";
import { PipelineRun, type RunStatus } from "./PipelineRun.js";

export interface ExecutionOptions {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly initialState: State;
  readonly pipeline?: Pipeline;
  readonly run?: PipelineRun;
}

export class Execution {
  readonly id: string;
  readonly version: PipelineVersion;
  readonly initialState: State;
  readonly run: PipelineRun;
  readonly pipeline?: Pipeline;

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
    });
  }
}