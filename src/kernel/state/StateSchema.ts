import { DomainError } from "../DomainError.js";

export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "any" | "null";

export interface SchemaField {
  readonly type: FieldType;
  readonly required?: boolean;
  readonly items?: FieldType;
}

export interface StateSchemaOptions {
  readonly name: string;
  readonly version?: number;
  readonly fields?: Readonly<Record<string, SchemaField>>;
}

export interface SchemaValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export class StateSchema {
  readonly name: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, SchemaField>>;

  constructor(options: StateSchemaOptions) {
    const name = options.name.trim();
    if (name.length === 0) {
      throw new DomainError({ code: "INVALID_INPUT", message: "StateSchema name must be a non-empty string" });
    }
    this.name = name;
    this.version = options.version ?? 1;
    this.fields = Object.freeze({ ...options.fields });
    Object.freeze(this);
  }

  validate(value: Readonly<Record<string, unknown>> = {}): SchemaValidationResult {
    const errors: string[] = [];
    const keys = new Set(Object.keys(value));
    for (const [field, definition] of Object.entries(this.fields)) {
      if (!keys.has(field)) {
        if (definition.required !== false) {
          errors.push(`Missing required field "${field}"`);
        }
        continue;
      }
      const fieldError = validateField(field, value[field], definition);
      if (fieldError) {
        errors.push(fieldError);
      }
    }
    return { ok: errors.length === 0, errors: Object.freeze(errors) };
  }
}

function validateField(field: string, value: unknown, definition: SchemaField): string | undefined {
  if (value === null || value === undefined) {
    if (definition.required === false) {
      return undefined;
    }
    return `Field "${field}" must not be null/undefined`;
  }
  if (definition.type === "any") {
    return undefined;
  }
  if (typeof value === "string" && definition.type === "string") {
    return undefined;
  }
  if (typeof value === "number" && definition.type === "number") {
    return undefined;
  }
  if (typeof value === "boolean" && definition.type === "boolean") {
    return undefined;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && definition.type === "object") {
    return undefined;
  }
  if (Array.isArray(value) && definition.type === "array") {
    if (definition.items && value.some((item) => typeof item !== definition.items)) {
      return `Field "${field}" contains an item that is not "${definition.items}"`;
    }
    return undefined;
  }
  if (value === null && definition.type === "null") {
    return undefined;
  }
  return `Field "${field}" expected "${definition.type}" but got "${typeof value}"`;
}