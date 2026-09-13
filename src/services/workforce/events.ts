import { getStores } from '../../data/stores';
import { EventRecord } from '../../data/types';

let counter = 0;

export type EventProcessor = (event: EventRecord) => void;
let eventProcessor: EventProcessor | undefined;

export function setEventProcessor(processor: EventProcessor | undefined): void {
  eventProcessor = processor;
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
  return event;
}