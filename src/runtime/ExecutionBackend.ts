import { Execution, EventBus, PipelineVersion, State } from "../kernel/index.js";

export interface ExecuteOptions {
  readonly id?: string;
  readonly initialState?: State;
  readonly eventBus?: EventBus;
  readonly signal?: AbortSignal;
  readonly pipelineId?: string;
  readonly pipelineVersion?: number;
}

export interface ExecutionBackend {
  execute(
    version: PipelineVersion,
    options: ExecuteOptions
  ): Promise<Execution>;
}
