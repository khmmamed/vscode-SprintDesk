import { Event, type EventPayload } from "./Event.js";

export type EventListener = (event: Event) => void;
export type Unsubscribe = () => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly wildcardListeners = new Set<EventListener>();
  private readonly published: Event[] = [];
  private sequence = 0;

  subscribe(type: string, listener: EventListener): Unsubscribe {
    const key = type.trim();
    if (key.length === 0) {
      throw new Error("Cannot subscribe to an empty event type");
    }
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  once(type: string, listener: EventListener): Unsubscribe {
    const unsubscribe = this.subscribe(type, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  onAny(listener: EventListener): Unsubscribe {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  publish(type: string, payload: EventPayload = {}): Event {
    const event = new Event({ type, payload, sequence: ++this.sequence });
    this.published.push(event);
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) {
        listener(event);
      }
    }
    for (const listener of this.wildcardListeners) {
      listener(event);
    }
    return event;
  }

  history(): readonly Event[] {
    return this.published;
  }

  historyOf(type: string): readonly Event[] {
    return this.published.filter((event) => event.type === type);
  }
}