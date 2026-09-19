import { Capability } from "./Capability.js";

export interface CapabilityHandler<TContext = unknown, TInput = unknown, TOutput = unknown> {
  readonly capabilityId: string;
  run(input: TInput, context: TContext): Promise<TOutput>;
}
