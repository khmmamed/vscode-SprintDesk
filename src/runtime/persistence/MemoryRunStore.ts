import type { RunStore, StoredRun } from "./RunStore.js";

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRun>();

  save(run: StoredRun): void {
    this.runs.set(run.id, { ...run });
  }

  get(runId: string): StoredRun | null {
    return this.runs.get(runId) ?? null;
  }

  list(): StoredRun[] {
    return [...this.runs.values()];
  }

  delete(runId: string): void {
    this.runs.delete(runId);
  }
}