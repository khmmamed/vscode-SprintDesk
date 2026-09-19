import { DomainError } from "../DomainError.js";
import { CapabilityHandler } from "./CapabilityHandler.js";

export class CapabilityHandlerRegistry {
  private readonly handlers = new Map<string, CapabilityHandler<any, any, any>>();

  register<TContext, TInput, TOutput>(handler: CapabilityHandler<TContext, TInput, TOutput>): void {
    if (this.handlers.has(handler.capabilityId)) {
      throw new DomainError({
        code: "DUPLICATE_ID",
        message: `Handler for capability with id "${handler.capabilityId}" is already registered`,
      });
    }
    this.handlers.set(handler.capabilityId, handler);
  }

  get<TContext, TInput, TOutput>(capabilityId: string): CapabilityHandler<TContext, TInput, TOutput> {
    const handler = this.handlers.get(capabilityId);
    if (!handler) {
      throw new DomainError({
        code: "UNRESOLVED_REFERENCE",
        message: `No handler registered for capability with id "${capabilityId}"`,
      });
    }
    return handler as CapabilityHandler<TContext, TInput, TOutput>;
  }

  has(capabilityId: string): boolean {
    return this.handlers.has(capabilityId);
  }

  list(): readonly CapabilityHandler<any, any, any>[] {
    return Array.from(this.handlers.values());
  }

  remove(capabilityId: string): boolean {
    return this.handlers.delete(capabilityId);
  }
}
