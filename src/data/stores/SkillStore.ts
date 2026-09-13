import { YAMLStore } from './BaseStore';
import { Skill } from '../types';
import { Task } from '../types';

export type TaskType = Task['type'];

export const DEFAULT_TYPE_SKILLS: Record<TaskType, string[]> = {
  bug: ['debugging'],
  doc: ['documentation'],
  test: ['testing'],
  feature: ['typescript', 'vscode-extension', 'apis'],
  chore: ['planning']
};

export const DEFAULT_SKILLS: Skill[] = [
  { id: 'skill_debugging', name: 'debugging', category: 'engineering', aliases: ['bug', 'bugfix'], description: 'Root-cause and fix defects' },
  { id: 'skill_documentation', name: 'documentation', category: 'comms', aliases: ['doc', 'docs'], description: 'Author and maintain user/developer docs' },
  { id: 'skill_testing', name: 'testing', category: 'engineering', aliases: ['tests', 'qa'], description: 'Write and run tests' },
  { id: 'skill_typescript', name: 'typescript', category: 'engineering', aliases: ['ts'], description: 'TypeScript development' },
  { id: 'skill_vscode-extension', name: 'vscode-extension', category: 'engineering', aliases: ['vscode'], description: 'VS Code extension development' },
  { id: 'skill_apis', name: 'apis', category: 'engineering', aliases: ['api', 'integration'], description: 'API design and integration' },
  { id: 'skill_review', name: 'review', category: 'process', aliases: ['code-review'], description: 'Code and design review' },
  { id: 'skill_planning', name: 'planning', category: 'process', aliases: ['scrum', 'agile'], description: 'Sprint and backlog planning' }
];

export class SkillStore extends YAMLStore<Skill> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'skills.yml', 'skills', workspaceRoot);
  }

  findByName(name: string): Skill | undefined {
    const needle = name.trim().toLowerCase();
    return this.loadAll().find(
      s =>
        s.name.toLowerCase() === needle ||
        (s.aliases || []).some(a => a.toLowerCase() === needle)
    );
  }

  nameToSkill(): Map<string, Skill> {
    const map = new Map<string, Skill>();
    for (const skill of this.loadAll()) {
      map.set(skill.name.toLowerCase(), skill);
      for (const alias of skill.aliases || []) {
        map.set(alias.toLowerCase(), skill);
      }
    }
    return map;
  }

  upsert(skill: Skill): Skill {
    const all = this.loadAll();
    const index = all.findIndex(s => s.id === skill.id);
    if (index !== -1) {
      all[index] = skill;
    } else {
      all.push(skill);
    }
    this.saveAll(all);
    return skill;
  }

  seedDefaultSkills(): number {
    const all = this.loadAll();
    let added = 0;
    for (const skill of DEFAULT_SKILLS) {
      if (all.some(s => s.name.toLowerCase() === skill.name.toLowerCase())) {
        continue;
      }
      all.push(skill);
      added++;
    }
    if (added > 0) {
      this.saveAll(all);
    }
    return added;
  }
}