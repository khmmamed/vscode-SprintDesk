import { Execution, PipelineVersion } from "../kernel/index.js";
import { ExecutionBackend, type ExecuteOptions } from "./ExecutionBackend.js";
import { Executor } from "./Executor.js";

export class InProcessExecutionBackend implements ExecutionBackend {
  constructor(readonly executor: Executor) {}

  async execute(
    version: PipelineVersion,
    options: ExecuteOptions
  ): Promise<Execution> {
    return this.executor.execute(version, options);
  }
}
