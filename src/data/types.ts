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

  // v0.4 workforce / agent additions (all optional, additive, non-breaking)
  source?: string;
  workStatus?: TaskWorkStatus;
  agent?: string;
  workflow?: string;
  parentTaskId?: string;
  childTaskIds?: string[];
  runId?: string;
  attempts?: number;

  // v0.5 workforce semantics (all optional, additive, non-breaking)
  requiredSkills?: string[];
}

export type TaskWorkStatus =
  | 'waiting'
  | 'assigned'
  | 'claimed'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'cancelled';

export interface Run {
  id: string;
  taskId: string;
  agentId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  availableAt?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface Employee {
  id: string;
  name: string;
  role: 'agent' | 'human';
  description?: string;
  capabilities?: string[];
  status?: 'idle' | 'busy' | 'offline';
  gitAuthor?: string;
  createdAt: string;
  updatedAt: string;

  // v0.5 workforce semantics (all optional, additive, non-breaking)
  skills?: EmployeeSkill[];
  agentConfig?: AgentConfig;
  teamRole?: EmployeeTeamRole;

  // v0.7 provider semantics (additive, non-breaking)
  modelProfile?: EmployeeModelProfile;
}

export type EmployeeSkillLevel = 1 | 2 | 3;

export interface EmployeeSkill {
  name: string;
  level?: EmployeeSkillLevel;
}

export type EmployeeTeamRole = 'lead' | 'developer' | 'reviewer' | 'observer' | 'agent' | 'human';

export interface Skill {
  id: string;
  name: string;
  category?: string;
  description?: string;
  aliases?: string[];
}

export type PermissionId = string;

export interface EmployeePolicyOverride {
  employeeId: string;
  allow?: PermissionId[];
  deny?: PermissionId[];
}

export interface Policy {
  roles: Record<string, PermissionId[]>;
  overrides?: EmployeePolicyOverride[];
  updatedAt?: string;
}

export const DEFAULT_POLICY: Policy = {
  roles: {
    lead: ['task:assign', 'task:claim', 'run:create', 'run:update', 'run:cancel', 'mcp:list', 'mcp:call', 'approval:review', 'approval:configure'],
    developer: ['task:claim', 'run:create'],
    reviewer: ['task:assign', 'task:claim'],
    observer: [],
    agent: ['run:create', 'run:update', 'task:claim', 'mcp:list', 'mcp:call'],
    human: ['task:assign', 'task:claim', 'approval:review', 'approval:configure']
  },
  overrides: []
};

export type ApprovalGateMode = 'auto' | 'manual';

export interface ApprovalGates {
  taskAssignment: ApprovalGateMode;
  runExecution: ApprovalGateMode;
  configChange: ApprovalGateMode;
}

export const DEFAULT_APPROVAL_GATES: ApprovalGates = {
  taskAssignment: 'auto',
  runExecution: 'auto',
  configChange: 'auto'
};

export type ApprovalType = 'task-assignment' | 'run-execution' | 'config-change';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalPendingAssignTask {
  op: 'assign-task';
  taskId: string;
  employeeId: string;
  employeeName?: string;
  requesterId?: string;
}

export interface ApprovalPendingStartRun {
  op: 'start-run';
  runId: string;
  agentId: string;
}

export interface ApprovalPendingConfigChange {
  op: 'apply-config';
  employeeId: string;
  changes: {
    modelProfile?: EmployeeModelProfile;
    agentConfig?: AgentConfig;
    capabilities?: string[];
  };
  requesterId?: string;
}

export type ApprovalPending =
  | ApprovalPendingAssignTask
  | ApprovalPendingStartRun
  | ApprovalPendingConfigChange;

export interface Approval {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  reason: string;
  target: string;
  requesterId?: string;
  pending: ApprovalPending;
  createdAt: string;
  resolvedAt?: string;
  decisionBy?: string;
}

export type WorkerMode = 'headless' | 'terminal' | 'noop';

export interface QueueSettings {
  id: string;
  enabled: boolean;
  maxConcurrentRuns: number;
  autoAssignUnassigned: boolean;
  workerMode: WorkerMode;
  pollIntervalMs: number;
  runTimeoutMs: number;
  maxRunRetries: number;
  retryBackoffMs: number;
  approvalGates: ApprovalGates;
}

export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  id: 'default',
  enabled: false,
  maxConcurrentRuns: 1,
  autoAssignUnassigned: false,
  workerMode: 'headless',
  pollIntervalMs: 30000,
  runTimeoutMs: 600000,
  maxRunRetries: 1,
  retryBackoffMs: 30000,
  approvalGates: { ...DEFAULT_APPROVAL_GATES }
};

export interface EmployeeTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  leadId?: string;
  createdAt: string;
  updatedAt: string;
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

// v0.7 provider semantics (additive, non-breaking)
export type LLMProviderKind = 'ollama' | 'openai';

export interface EmployeeModelProfile {
  name: string;
  provider: LLMProviderKind;
  model: string;
  baseUrl?: string;
  apiKeyRef?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
}

// v0.7 MCP server registrations (additive, non-breaking)
export type McpServerKind = 'stdio' | 'http';

export interface McpServerConfig {
  id: string;
  kind: McpServerKind;
  name?: string;
  description?: string;
  enabled: boolean;
  url?: string;
  command?: string;
  args?: string[];
  headersRef?: string;
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
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

export interface RunsData {
  runs: Run[];
}

export interface EventsData {
  events: EventRecord[];
}

export interface AuditData {
  entries: AuditEntry[];
}

export interface QueueSettingsData {
  queue: QueueSettings[];
}

export interface EmployeesData {
  employees: Employee[];
}

export interface EmployeeTeamsData {
  teams: EmployeeTeam[];
}

export interface SkillsData {
  skills: Skill[];
}

export type AutonomyLevel = 0 | 1 | 2 | 3;

// v0.8 scheduler semantics (additive, non-breaking)
export type ScheduleKind = 'cron' | 'interval';

export interface ScheduleTaskTemplate {
  name: string;
  title?: string;
  type: Task['type'];
  priority: Task['priority'];
  backlog?: string;
  epicName?: string;
}

export interface ScheduleRecord {
  id: string;
  name: string;
  enabled: boolean;
  kind: ScheduleKind;
  autonomyLevel: AutonomyLevel;
  taskTemplate: ScheduleTaskTemplate;

  // cron schedules (kind === 'cron') - 5-field deterministic expression
  cron?: string;
  // interval schedules (kind === 'interval')
  intervalMs?: number;

  lastRunAt?: string;
  lastOccurrenceKey?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 1;

export interface SchedulesData {
  schedules: ScheduleRecord[];
}

export interface McpServersData {
  servers: McpServerConfig[];
}