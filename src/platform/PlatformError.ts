export type PlatformErrorCode =
  | "PIPELINE_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_PUBLISHED"
  | "INVALID_PLATFORM_OPERATION"
  | "POLICY_DENIED";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: PlatformErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.details = details ? Object.freeze({ ...details }) : undefined;
    Object.freeze(this);
  }
}