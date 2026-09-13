import { getStores } from '../../data/stores';
import { EventRecord } from '../../data/types';

let counter = 0;

export type EventProcessor = (event: EventRecord) => void;
let eventProcessor: EventProcessor | undefined;

const subscribers = new Set<EventProcessor>();

// v0.11 slice 6 — additive listeners so the Control Center can refresh from the same event stream
export function setEventProcessor(processor: EventProcessor | undefined): void {
  eventProcessor = processor;
}

export function subscribeEvents(listener: EventProcessor): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function emitEvent(type: string, source: string, payload: Record<string, unknown>): EventRecord {
  counter += 1;
  const event: EventRecord = {
    id: `evt_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    source,
    payload,
    timestamp: new Date().toISOString()
  };
  getStores().events.add(event);
  if (eventProcessor) {
    eventProcessor(event);
  }
  for (const listener of subscribers) {
    listener(event);
  }
  return event;
}