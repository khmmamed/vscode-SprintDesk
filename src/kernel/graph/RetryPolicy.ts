import { DomainError } from "../DomainError.js";

export interface RetryPolicyOptions {
  readonly maxAttempts: number;
  readonly delayMs?: number;
}

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly delayMs?: number;

  constructor(options: RetryPolicyOptions) {
    const maxAttempts = options.maxAttempts;
    if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new DomainError({
        code: "INVALID_INPUT",
        message: "RetryPolicy maxAttempts must be an integer >= 1",
        details: { maxAttempts },
      });
    }
    if (options.delayMs !== undefined) {
      if (typeof options.delayMs !== "number" || !Number.isFinite(options.delayMs) || options.delayMs < 0) {
        throw new DomainError({
          code: "INVALID_INPUT",
          message: "RetryPolicy delayMs must be a finite number >= 0",
          details: { delayMs: options.delayMs },
        });
      }
    }
    this.maxAttempts = maxAttempts;
    this.delayMs = options.delayMs;
    Object.freeze(this);
  }
}