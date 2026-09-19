export type EventPayload = Readonly<Record<string, unknown>>;

export interface EventOptions {
  readonly type: string;
  readonly payload?: EventPayload;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export class Event {
  readonly type: string;
  readonly payload: EventPayload;
  readonly sequence: number;
  readonly timestamp: number;

  constructor(options: EventOptions) {
    const type = options.type.trim();
    if (type.length === 0) {
      throw new Error("Event type must be a non-empty string");
    }
    this.type = type;
    this.payload = Object.freeze({ ...options.payload });
    this.sequence = options.sequence ?? 0;
    this.timestamp = options.timestamp ?? Date.now();
    Object.freeze(this);
  }
}