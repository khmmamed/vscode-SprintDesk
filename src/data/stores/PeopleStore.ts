import * as path from 'path';
import yaml from 'js-yaml';
import { Employee } from '../types';
import { getFileSystem, getHost, IFileSystem } from '../../host';

/**
 * The unified People directory. Humans and agents are intentionally stored in
 * separate files while sharing one stable identity space for teams and runs.
 */
export class PeopleStore {
  private readonly root: string;
  private readonly fileSystem: IFileSystem;

  constructor(workspaceRoot?: string) {
    this.root = workspaceRoot || getHost().getWorkspaceRoot() || '';
    this.fileSystem = getFileSystem();
  }

  loadAll(): Employee[] {
    return [...this.load('humans'), ...this.load('agents')];
  }

  loadHumans(): Employee[] {
    return this.load('humans');
  }

  loadAgents(): Employee[] {
    return this.load('agents');
  }

  getById(id: string): Employee | undefined {
    return this.loadAll().find(person => person.id === id);
  }

  add(person: Employee): void {
    const people = this.load(person.role === 'agent' ? 'agents' : 'humans');
    people.push(person);
    this.save(person.role === 'agent' ? 'agents' : 'humans', people);
  }

  update(id: string, updates: Partial<Employee>): void {
    const current = this.getById(id);
    if (!current) return;

    const beforeKind = current.role === 'agent' ? 'agents' : 'humans';
    const updated = { ...current, ...updates } as Employee;
    const afterKind = updated.role === 'agent' ? 'agents' : 'humans';
    const before = this.load(beforeKind).filter(person => person.id !== id);

    if (beforeKind === afterKind) {
      before.push(updated);
      this.save(beforeKind, before);
      return;
    }

    this.save(beforeKind, before);
    const after = this.load(afterKind);
    after.push(updated);
    this.save(afterKind, after);
  }

  delete(id: string): void {
    for (const kind of ['humans', 'agents'] as const) {
      const people = this.load(kind);
      if (people.some(person => person.id === id)) {
        this.save(kind, people.filter(person => person.id !== id));
        return;
      }
    }
  }

  count(): number {
    return this.loadAll().length;
  }

  findByRole(role: Employee['role']): Employee[] {
    return role === 'agent' ? this.loadAgents() : this.loadHumans();
  }

  private load(kind: 'humans' | 'agents'): Employee[] {
    try {
      const filePath = this.pathFor(kind);
      if (!this.fileSystem.exists(filePath)) return [];
      const content = this.fileSystem.readFile(filePath);
      const parsed = yaml.load(content) as Record<string, Employee[]>;
      return parsed[kind] || [];
    } catch {
      return [];
    }
  }

  private save(kind: 'humans' | 'agents', people: Employee[]): void {
    const filePath = this.pathFor(kind);
    this.fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    this.fileSystem.writeFile(filePath, yaml.dump({ [kind]: people }));
  }

  private pathFor(kind: 'humans' | 'agents'): string {
    return path.join(this.root, '.SprintDesk', 'people', `${kind}.yml`);
  }
}
