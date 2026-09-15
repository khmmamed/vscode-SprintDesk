import * as path from 'path';
import yaml from 'js-yaml';
import { getFileSystem, getHost, IFileSystem } from '../../host';

export interface StoreRecord {
  id: string;
}

export class YAMLStore<T extends StoreRecord> {
  protected filePath: string;
  private readonly legacyFilePath?: string;
  private readonly listKey: string;
  private readonly fileSystem: IFileSystem;

  constructor(
    relativeDir: string,
    fileName: string,
    listKey: string,
    workspaceRoot?: string,
    legacyRelativeDir?: string,
    legacyFileName?: string
  ) {
    const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
    this.filePath = path.join(root, '.SprintDesk', relativeDir, fileName);
    this.listKey = listKey;
    this.fileSystem = getFileSystem();
    if (legacyRelativeDir) {
      this.legacyFilePath = path.join(root, '.SprintDesk', legacyRelativeDir, legacyFileName || fileName);
    }
  }

  loadAll(): T[] {
    if (this.fileSystem.exists(this.filePath)) {
      return this.readList(this.filePath);
    }
    // v1.0 Slice A — one-way continuity fallback: relocated stores still surface
    // records that were persisted in the pre-database/ location, until the first
    // write moves state under database/.
    if (this.legacyFilePath && this.fileSystem.exists(this.legacyFilePath)) {
      return this.readList(this.legacyFilePath);
    }
    return [];
  }

  private readList(file: string): T[] {
    try {
      const content = this.fileSystem.readFile(file);
      const data = yaml.load(content) as Record<string, T[]>;
      return data[this.listKey] || [];
    } catch {
      return [];
    }
  }

  saveAll(items: T[]): void {
    this.fileSystem.mkdir(path.dirname(this.filePath), { recursive: true });
    this.fileSystem.writeFile(this.filePath, yaml.dump({ [this.listKey]: items }));
  }

  getById(id: string): T | undefined {
    return this.loadAll().find(r => r.id === id);
  }

  add(item: T): void {
    const all = this.loadAll();
    all.push(item);
    this.saveAll(all);
  }

  update(id: string, updates: Partial<T>): void {
    const all = this.loadAll();
    const index = all.findIndex(r => r.id === id);
    if (index !== -1) {
      all[index] = { ...all[index], ...updates } as T;
      this.saveAll(all);
    }
  }

  delete(id: string): void {
    const all = this.loadAll().filter(r => r.id !== id);
    this.saveAll(all);
  }

  count(): number {
    return this.loadAll().length;
  }

  // Sequential id allocation against the persisted registry (e.g. PLAN-0001),
  // derived from the highest existing counter so ids survive reloads.
  protected nextIdFromCounter(prefix: string, pattern: RegExp, pad?: number): string {
    let max = 0;
    for (const item of this.loadAll()) {
      const match = pattern.exec(item.id);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    const next = max + 1;
    return pad ? `${prefix}${String(next).padStart(pad, '0')}` : `${prefix}${next}`;
  }
}