import * as vscode from 'vscode';

export interface Task {
  id: string;
  number: number;
  code: string;
  name: string;
  title: string;
  type: 'feature' | 'bug' | 'chore' | 'doc' | 'test';
  status: 'waiting' | 'in-progress' | 'review' | 'done' | 'blocked' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  epic: string | null;
  backlog: string;
  sprint: string | null;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
}

export interface Epic {
  id: string;
  number: number;
  code: string;
  name: string;
  title: string;
  category: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  tasks: string[];
  createdAt: string;
  updatedAt: string;
  path?: string;
}

export interface Backlog {
  id: string;
  title: string;
  name: string;
  description: string;
  tasks: string[];
  color: string;
  path?: string;
}

export interface Sprint {
  id: string;
  number: number;
  title: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'in-progress' | 'completed';
  tasks: string[];
  createdAt: string;
  updatedAt: string;
  path?: string;
}

export interface IdsConfig {
  task: { prefix: string; startNumber: number; padding: number };
  epic: { prefix: string; startNumber: number; padding: number };
  sprint: { prefix: string; startNumber: number; padding: number };
  backlog: { prefix: string };
}

export interface DefaultsConfig {
  backlog: string | null;
  epic: string | null;
  sprint: string | null;
  status: string;
  priority: string;
  type: string;
}

export interface UIConfig {
  showCompleted: boolean;
  defaultView: 'tree' | 'table';
  showIds: boolean;
  dateFormat: 'iso' | 'short' | 'relative';
}

export interface DirectoriesConfig {
  data: string;
  tasks: string;
  backlogs: string;
  epics: string;
  sprints: string;
  templates: string;
}

export interface Config {
  projectPrefix: string;
  developBranch: string;
  ids: IdsConfig;
  defaults: DefaultsConfig;
  ui: UIConfig;
  directories: DirectoriesConfig;
}

export const DEFAULT_CONFIG: Config = {
  projectPrefix: 'SPD',
  developBranch: 'develop',
  ids: {
    task: { prefix: 'task_', startNumber: 100, padding: 3 },
    epic: { prefix: 'epic_', startNumber: 1, padding: 2 },
    sprint: { prefix: 'sprint_', startNumber: 1, padding: 1 },
    backlog: { prefix: '' }
  },
  defaults: {
    backlog: 'features',
    epic: null,
    sprint: null,
    status: 'waiting',
    priority: 'medium',
    type: 'feature'
  },
  ui: {
    showCompleted: false,
    defaultView: 'tree',
    showIds: true,
    dateFormat: 'iso'
  },
  directories: {
    data: 'data',
    tasks: 'Tasks',
    backlogs: 'Backlogs',
    epics: 'Epics',
    sprints: 'Sprints',
    templates: 'templates'
  }
};

export interface TasksData {
  tasks: Task[];
}

export interface EpicsData {
  epics: Epic[];
}

export interface BacklogsData {
  backlogs: Backlog[];
}

export interface SprintsData {
  sprints: Sprint[];
}

export interface AgentConfig {
  tool: 'opencode' | 'ollama' | 'claude-code' | 'custom';
  command?: string;
  model?: string;
}

export interface AgentRole {
  name: string;
  role: string;
  tool: 'opencode' | 'ollama' | 'claude-code' | 'custom';
  workingDir?: string;
  promptTemplate?: string;
  model?: string;
  command?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: 'lead' | 'developer' | 'reviewer' | 'observer' | 'agent';
  agentConfig?: AgentConfig;
  gitAuthor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  itemId: string;
  itemType: 'task' | 'epic' | 'backlog' | 'sprint';
  action: 'create' | 'update' | 'delete' | 'move' | 'assign';
  field?: string;
  oldValue?: string;
  newValue?: string;
  author: string;
  authorEmail?: string;
  commitHash?: string;
  timestamp: string;
}

export interface TeamData {
  members: TeamMember[];
}

export interface HistoryData {
  entries: HistoryEntry[];
}