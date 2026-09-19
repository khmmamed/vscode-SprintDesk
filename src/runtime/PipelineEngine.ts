import { DomainError, type Execution, type PipelineVersion, type State } from "../kernel/index.js";
import type { EventBus } from "../kernel/index.js";
import type { PipelineRegistry } from "../kernel/index.js";
import type { Runtime, RuntimeRunOptions } from "./Runtime.js";

export interface EngineRunOptions {
  readonly pipelineId: string;
  readonly version?: number;
  readonly id?: string;
  readonly initialState?: State;
  readonly eventBus?: EventBus;
}

export class PipelineEngine {
  constructor(
    private readonly registry: PipelineRegistry,
    private readonly runtime: Runtime
  ) {}

  async run(options: EngineRunOptions): Promise<Execution> {
    const version = this.resolve(options);
    return this.runtime.execute(version, this.runOptions(options));
  }

  start(options: EngineRunOptions): string {
    const version = this.resolve(options);
    return this.runtime.start(version, this.runOptions(options));
  }

  private resolve(options: EngineRunOptions): PipelineVersion {
    const pipeline = this.registry.get(options.pipelineId);
    if (options.version !== undefined) {
      const version = pipeline.versions.find((candidate) => candidate.version === options.version);
      if (!version) {
        throw new DomainError({
          code: "NOT_FOUND",
          message: `Pipeline "${pipeline.id}" has no version ${options.version}`,
          details: { pipelineId: pipeline.id, version: options.version },
        });
      }
      return version;
    }
    const version = pipeline.latestVersion();
    if (!version) {
      throw new DomainError({
        code: "NOT_FOUND",
        message: `Pipeline "${pipeline.id}" has no executable version`,
        details: { pipelineId: pipeline.id },
      });
    }
    return version;
  }

  private runOptions(options: EngineRunOptions): RuntimeRunOptions {
    return {
      id: options.id,
      initialState: options.initialState,
      eventBus: options.eventBus,
      pipelineId: options.pipelineId,
    };
  }
}