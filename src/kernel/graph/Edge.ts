import { DomainError } from "../DomainError.js";

export interface EdgeCondition extends Readonly<Record<string, unknown>> {}

export interface EdgeOptions {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly condition?: EdgeCondition;
}

export class Edge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly condition?: EdgeCondition;

  constructor(options: EdgeOptions) {
    const from = options.from.trim();
    const to = options.to.trim();
    if (from.length === 0 || to.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "Edge endpoints must be non-empty strings" });
    }
    this.from = from;
    this.to = to;
    this.label = options.label;
    this.condition = options.condition ? Object.freeze({ ...options.condition }) : undefined;
    Object.freeze(this);
  }
}