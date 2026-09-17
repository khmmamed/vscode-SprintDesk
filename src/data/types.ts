export interface Run {
  id: string;
  // v1.0 Slice D — the Plan is the execution identity (taskId removed); the Run key
  // stays `runs` in database/executions.yml.
  planId: string;
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

  // v0.10 structured outcome summary (additive, non-breaking)
  summary?: RunSummary;
}

export interface RunSummary {
  findings: number;
  errors: number;
}

// v0.11 findings as a first-class workforce object (additive, non-breaking)
export type FindingSeverity = 'low' | 'medium' | 'high';
export type FindingStatus = 'pending' | 'approved' | 'rejected';

export interface FindingSource {
  runId: string;
  type?: string;
  reference?: string;
}

// v0.11 agent validation & review (additive, non-breaking)
export type FindingRecommendation = 'recommend-approve' | 'recommend-reject' | 'request-revision';

export interface FindingAgentReview {
  validatorId: string;
  validatorName?: string;
  recommendation: FindingRecommendation;
  confidence?: number;
  reason?: string;
  validatedAt: string;
}

export type FindingAgentReviewState = 'requested' | 'validated';

// v0.12 autonomous classification: proposals (additive, non-breaking)
export type ProposalStatus = 'pending' | 'applied' | 'duplicate' | 'skipped' | 'failed' | 'rejected';

// Classification vocab pulled off the legacy Task domain so proposals, findings,
// and workflow steps no longer depend on the Task type (removed Slice I).
export type ProposalType = 'feature' | 'bug' | 'chore' | 'doc' | 'test';
export type ProposalPriority = 'high' | 'medium' | 'low';

export interface ProposalPayload {
  title: string;
  type: ProposalType;
  priority: ProposalPriority;
  workflow?: string;
}

export interface ProposalEdit {
  at: string;
  by?: string;
  before: Partial<ProposalPayload>;
  after: Partial<ProposalPayload>;
}

export interface Proposal {
  id: string;
  findingId: string;
  runId: string;
  agent: string;
  agentName?: string;
  title: string;
  type: ProposalType;
  priority: ProposalPriority;
  workflow?: string;
  confidence?: number;
  status: ProposalStatus;
  proposedBy?: string;
  appliedPlanId?: string;
  appliedAt?: string;
  reason?: string;
  createdAt: string;
  editedAt?: string;
  editedBy?: string;
  edits?: ProposalEdit[];
  requeuedAt?: string;
}

export interface Finding {
  id: string;
  title: string;
  description?: string;
  evidence?: string;
  source: FindingSource;
  agent: string;
  agentName?: string;
  timestamp: string;
  severity: FindingSeverity;
  confidence?: number;
  category?: string;
  suggestedType?: ProposalType;
  suggestedWorkflow?: string;
  suggestedPriority?: ProposalPriority;
  status: FindingStatus;
  // v1.0 Slice D — findings produced by a run link to the executed Plan (planId).
  planId?: string;
  resolvedAt?: string;
  decisionBy?: string;

  // v0.11 agent validation & review (additive, non-breaking)
  agentValidationState?: FindingAgentReviewState;
  agentValidationRequestedAt?: string;
  agentReview?: FindingAgentReview;
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
  email?: string;
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
    lead: ['run:create', 'run:update', 'run:cancel', 'mcp:list', 'mcp:call', 'approval:review', 'approval:configure', 'event-rule:manage', 'classification:propose', 'classification:review', 'classification:apply', 'plan:deploy'],
    developer: ['run:create'],
    reviewer: ['finding:validate', 'classification:review'],
    observer: [],
    agent: ['run:create', 'run:update', 'run:cancel', 'mcp:list', 'mcp:call', 'classification:propose'],
    human: ['approval:review', 'approval:configure', 'event-rule:manage', 'classification:review', 'classification:apply', 'plan:deploy']
  },
  overrides: []
};

export type ApprovalGateMode = 'auto' | 'manual';

export interface ApprovalGates {
  runExecution: ApprovalGateMode;
  configChange: ApprovalGateMode;
  planClassification: ApprovalGateMode;
  // v1.0 Slice G — deploy authorization is human-gated by default (manual); there
  // is never an automatic deploy path even if the gate were switched to auto.
  deploy: ApprovalGateMode;
}

export const DEFAULT_APPROVAL_GATES: ApprovalGates = {
  runExecution: 'auto',
  configChange: 'auto',
  planClassification: 'auto',
  deploy: 'manual'
};

export type ApprovalType = 'run-execution' | 'config-change' | 'plan-classification' | 'deploy-authorization';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

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

export interface ApprovalPendingApplyProposal {
  op: 'apply-proposal';
  proposalId: string;
  requesterId?: string;
}

// v1.0 Slice G — deploy authorization flows through the existing approval
// mechanism (op 'authorize-deploy'); the checkpoint only moves to 'deployed'
// after a human resolves the approval in the affirmative.
export interface ApprovalPendingAuthorizeDeploy {
  op: 'authorize-deploy';
  checkpointId: string;
  planId: string;
  runId?: string;
  requesterId?: string;
}

export type ApprovalPending =
  | ApprovalPendingStartRun
  | ApprovalPendingConfigChange
  | ApprovalPendingApplyProposal
  | ApprovalPendingAuthorizeDeploy;

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

export type WorkerMode = 'headless' | 'terminal' | 'noop' | 'ollama';

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
  maxProposalsPerPass?: number;
  // v1.0 Slice B — Orchestrator pass bound (default 5)
  maxPlansPerPass?: number;
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
  maxProposalsPerPass: 5,
  maxPlansPerPass: 5,
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

export interface AgentConfig {
  tool: 'opencode' | 'ollama' | 'claude-code' | 'custom';
  /** For `tool: 'custom'`: the command line to run. Substituted placeholders are
   *  `{plan_path}` (the plan artifact), `{plan_dir}` (its directory), `{plan_file}`
   *  (its filename) and `{description}` (the full agent prompt). */
  command?: string;
  model?: string;
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

export interface HistoryEntry {
  id: string;
  itemId: string;
  itemType: 'plan' | 'run' | 'checkpoint';
  action: 'create' | 'update' | 'delete' | 'move' | 'assign';
  field?: string;
  oldValue?: string;
  newValue?: string;
  author: string;
  authorEmail?: string;
  commitHash?: string;
  timestamp: string;
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

export interface EmployeeTeamsData {
  teams: EmployeeTeam[];
}

export interface SkillsData {
  skills: Skill[];
}

export type AutonomyLevel = 0 | 1 | 2 | 3;

// v0.8 scheduler semantics (additive, non-breaking)
export type ScheduleKind = 'cron' | 'interval';

// v0.12 scheduled classification: a schedule can fire a classification pass instead of a task+run (additive)
export type ScheduleAction = 'plan' | 'classify' | 'organize';

export interface SchedulePlanTemplate {
  name: string;
  title?: string;
  objective?: string;
  implementation?: string;
  category: PlanCategory;
  priority: PlanPriority;
}

export interface ScheduleRecord {
  id: string;
  name: string;
  enabled: boolean;
  kind: ScheduleKind;
  autonomyLevel: AutonomyLevel;
  // plan schedules (default) materialize planTemplate into a pending Plan; classify
  // schedules replay the deterministic → LLM classification pass instead; organize
  // schedules fire an Organizer pass to assign and dispatch readiness work.
  action?: ScheduleAction;
  planTemplate?: SchedulePlanTemplate;

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

export interface FindingsData {
  findings: Finding[];
}

// v0.12 autonomous classification: persisted proposals (additive, non-breaking)
export interface ProposalsData {
  proposals: Proposal[];
}

// v0.11 event rules: event-based asynchronous automation (additive, non-breaking)
export interface EventRuleMatcher {
  eventType?: string;
  source?: string;
  payloadKey?: string;
  payloadValue?: string;
}

export type EventRuleTriggerStatus = 'completed' | 'failed';

export interface EventRuleTrigger {
  eventId: string;
  eventType: string;
  workflowId: string;
  status: EventRuleTriggerStatus;
  createdAt: string;
  // v1.0 Slice D — event-rule workflows materialize Plans (planId links), not Tasks.
  createdPlanIds?: string[];
  error?: string;
}

export interface EventRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  matcher: EventRuleMatcher;
  workflowId: string;
  workflowName?: string;
  runCount: number;
  lastTriggeredAt?: string;
  lastEventId?: string;
  recentTriggers: EventRuleTrigger[];
  createdAt: string;
  updatedAt: string;
}

export interface EventRulesData {
  eventRules: EventRule[];
}

export interface McpServersData {
  servers: McpServerConfig[];
}

// v0.9 workflow builder DSL — v1.0 Slice M: the `plan` step is plan-native
export type WorkflowStepType = 'plan' | 'loop' | 'tool' | 'condition';

export interface WorkflowBaseStep {
  id: string;
  name?: string;
  continueOnError?: boolean;
}

export interface WorkflowPlanStep extends WorkflowBaseStep {
  type: 'plan';
  title: string;
  category: PlanCategory;
  priority: PlanPriority;
  requiredSkills?: string[];
}

export interface WorkflowLoopStep extends WorkflowBaseStep {
  type: 'loop';
  maxIterations: number;
  iterateVar: string;
  body: WorkflowStep[];
}

export interface WorkflowToolStep extends WorkflowBaseStep {
  type: 'tool';
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  agent: string;
}

export type WorkflowConditionType = 'always' | 'never' | 'step-status';

export interface WorkflowStepStatusCondition {
  type: 'step-status';
  stepId: string;
  expectedStatus: 'completed' | 'failed';
}

export interface WorkflowStaticCondition {
  type: 'always' | 'never';
}

export type WorkflowCondition = WorkflowStepStatusCondition | WorkflowStaticCondition;

export interface WorkflowConditionStep extends WorkflowBaseStep {
  type: 'condition';
  when: WorkflowCondition;
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

export type WorkflowStep =
  | WorkflowPlanStep
  | WorkflowLoopStep
  | WorkflowToolStep
  | WorkflowConditionStep;

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped';
  outputs: Record<string, unknown>;
  error?: string;
}

export type WorkflowRunStatus = 'completed' | 'failed';

export interface WorkflowRunResult {
  workflowId: string;
  name: string;
  executedAt: string;
  status: WorkflowRunStatus;
  stepResults: WorkflowStepResult[];
  error?: string;
}

export interface WorkflowsData {
  workflows: WorkflowDefinition[];
}

// v0.11 slice 7 — execution windows: a persistent, synchronous batch of autonomous work
// (repurposes the old Sprint concept; NOT the legacy project-management sprint model)
export type ExecutionWindowStatus = 'planned' | 'running' | 'completed' | 'cancelled';

export interface ExecutionWindowCompletionSummary {
  runsCompleted: number;
  runsFailed: number;
  runsCancelled: number;
  findings: number;
  errors: number;
}

export interface ExecutionWindow {
  id: string;
  name: string;
  goal?: string;
  status: ExecutionWindowStatus;
  workflowIds: string[];
  agentIds: string[];
  workerMode?: WorkerMode;
  maxConcurrentRuns?: number;
  scheduledStartAt?: string;
  startedAt?: string;
  finishedAt?: string;
  // v1.0 Slice D — execution windows drive Plans through the queue (planIds), not Tasks.
  planIds: string[];
  runIds: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  completionSummary?: ExecutionWindowCompletionSummary;
}

export interface ExecutionWindowsData {
  executionWindows: ExecutionWindow[];
}

// v1.0 Slice A — Plan-native domain (additive, non-breaking) ------------------
// `plans/*.md` holds the semantic content (Orchestrator-written); `database/plans.yml`
// holds only registry state. classification.original is the Orchestrator's seed pass;
// classification.current/Organization may be corrected by the Organizer.

export type PlanCategory =
  | 'feature'
  | 'bug'
  | 'improvement'
  | 'refactor'
  | 'research'
  | 'documentation'
  | 'test'
  | 'maintenance'
  | 'security'
  | 'infrastructure'
  | 'data';

export type PlanUrgency = 'emergency' | 'urgent' | 'normal' | 'low' | 'scheduled';

export type PlanPriority = 'critical' | 'high' | 'medium' | 'low';

export type PlanComplexity = 'low' | 'medium' | 'high';

export type PlanRisk = 'low' | 'medium' | 'high';

export type PlanExecutionMode = 'immediate' | 'async' | 'sync' | 'scheduled' | 'blocked';

// Multi-dimensional classification — category and urgency are deliberately independent
// (a bug may be `normal`, a feature may be `emergency`).
export interface PlanClassificationAxis {
  category: PlanCategory;
  urgency: PlanUrgency;
  priority: PlanPriority;
  complexity: PlanComplexity;
  risk: PlanRisk;
  executionMode: PlanExecutionMode;
}

export interface PlanClassificationClassifier {
  type: 'agent' | 'human';
  id: string;
}

export interface PlanClassificationCurrent extends PlanClassificationAxis {
  reason?: string;
  classifiedBy: PlanClassificationClassifier;
}

export interface PlanClassification {
  original: PlanClassificationAxis;
  current?: PlanClassificationCurrent;
}

export type PlanOrganizationStatus = 'pending' | 'analyzing' | 'organized' | 'blocked' | 'escalated';

export interface PlanOrganization {
  status: PlanOrganizationStatus;
  version: number;
  lastRunAt?: string;
  lastDecisionAt?: string;
  decisionReason?: string;
}

export type PlanScheduleStatus = 'draft' | 'ready' | 'blocked' | 'running' | 'done' | 'failed' | 'cancelled';

export type PlanScheduleMode = 'immediate' | 'scheduled' | 'dependency';

export interface PlanScheduling {
  status: PlanScheduleStatus;
  mode: PlanScheduleMode;
  scheduledAt?: string;
  dependsOn: string[];
}

export type PlanExecutionStatus = 'unassigned' | 'assigned' | 'running' | 'completed' | 'failed';

export interface PlanAssignmentReason {
  capability: string[];
  availability: string;
  workload: number;
}

export interface PlanExecution {
  status: PlanExecutionStatus;
  assignedAgent?: string;
  assignmentReason?: PlanAssignmentReason;
  runId?: string;
}

export type PlanValidationDecision = 'passed' | 'failed' | 'revision';

export interface PlanValidation {
  decision: PlanValidationDecision;
  errors: string[];
  artifacts: string[];
  // v1.0 Slice J — lineage/idempotence marker recorded by the Validator stage.
  // Freshly materialized plans omit it; a value means the run whose outcome
  // produced this decision has already been validated (duplicate
  // `execution.completed` events must not re-validate or re-checkpoint).
  runId?: string;
  recordedAt?: string;
}

export interface PlanLineage {
  supersedes?: string;
  supersededBy?: string;
  planIds?: string[];
}

export interface PlanSource {
  inputId: string;
  checkpointId?: string;
}

export interface Plan {
  id: string;
  file: string;
  version: number;
  lineage: PlanLineage;
  source: PlanSource;
  organization: PlanOrganization;
  classification: PlanClassification;
  scheduling: PlanScheduling;
  execution: PlanExecution;
  validation: PlanValidation;
  createdAt: string;
  updatedAt: string;
}

export interface PlansData {
  plans: Plan[];
}

// v1.0 Slice A — inputs (Basket 1) (additive, non-breaking)
export type InputStatus = 'new' | 'planned' | 'failed';

export interface InputSource {
  type: 'human' | 'agent';
  id?: string;
  checkpointId?: string;
}

export interface InputRecord {
  id: string;
  file: string;
  status: InputStatus;
  source: InputSource;
  ingestedAt: string;
  plannedFrom?: string[];
  // v1.0 Slice B — content fingerprint used for discovery dedup (name + hash)
  contentHash?: string;
}

export interface InputsData {
  inputs: InputRecord[];
}

// v1.0 Slice A — lifecycle cycles (one CY-#### per continuous lifecycle round)
export type CycleOutcome = 'open' | 'closed-pass' | 'closed-fail' | 'cancelled';

export interface Cycle {
  id: string;
  inputIds: string[];
  planIds: string[];
  executionIds: string[];
  checkpointId?: string;
  organizationPasses: number;
  startedAt: string;
  closedAt?: string;
  outcome: CycleOutcome;
}

export interface CyclesData {
  cycles: Cycle[];
}

// v1.0 Slice A — checkpoints (Basket 3)
export type CheckpointStatus = 'ready' | 'deployment-authorizing' | 'deployed' | 'rejected';

export interface CheckpointDeploymentDecision {
  by: string;
  at: string;
  reason?: string;
}

export interface Checkpoint {
  id: string;
  planId: string;
  runId?: string;
  artifacts: string[];
  status: CheckpointStatus;
  // v1.0 Slice G — the checkpoint captures the exact Git position and the
  // validation evidence that produced it (additive, non-breaking).
  gitRef?: string;
  gitCommit?: string;
  validation?: {
    decision: 'passed';
    evidence: string[];
    validatedBy?: string;
    validatedAt: string;
  };
  deploymentDecision?: CheckpointDeploymentDecision;
}

export interface CheckpointsData {
  checkpoints: Checkpoint[];
}
