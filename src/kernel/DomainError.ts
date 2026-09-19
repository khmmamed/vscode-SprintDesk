export type DomainErrorCode =
  | "INVALID_INPUT"
  | "DUPLICATE_ID"
  | "UNRESOLVED_REFERENCE"
  | "CYCLE_DETECTED"
  | "SCHEMA_VIOLATION"
  | "ILLEGAL_TRANSITION"
  | "NOT_FOUND";

export interface DomainErrorOptions {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: DomainErrorOptions) {
    super(options.message);
    this.name = "DomainError";
    this.code = options.code;
    this.details = options.details ? Object.freeze({ ...options.details }) : undefined;
    Object.freeze(this);
  }
}