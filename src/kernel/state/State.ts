import { DomainError } from "../DomainError.js";
import { StateSchema } from "./StateSchema.js";

export type StateValue = Readonly<Record<string, unknown>>;

export interface StateOptions {
  readonly schema: StateSchema;
  readonly value: StateValue;
  readonly version?: number;
}

export class State {
  readonly schema: StateSchema;
  readonly value: StateValue;
  readonly version: number;

  constructor(options: StateOptions) {
    const result = options.schema.validate(options.value);
    if (!result.ok) {
      throw new DomainError({
        code: "SCHEMA_VIOLATION",
        message: `State does not conform to schema "${options.schema.name}": ${result.errors.join("; ")}`,
        details: { errors: result.errors },
      });
    }
    this.schema = options.schema;
    this.value = Object.freeze({ ...options.value });
    this.version = options.version ?? 1;
    Object.freeze(this);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.value[key] as T | undefined;
  }

  has(key: string): boolean {
    return key in this.value;
  }

  withValue(key: string, value: unknown): State {
    return new State({
      schema: this.schema,
      value: { ...this.value, [key]: value },
      version: this.version + 1,
    });
  }
}