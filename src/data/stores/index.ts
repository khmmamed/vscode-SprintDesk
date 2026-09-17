import { getWorkspaceRoot } from '../../services/fileService';
import { getHost } from '../../host';
import { RunStore } from './RunStore';
import { EventStore } from './EventStore';
import { AuditStore } from './AuditStore';
import { PlanStore } from './PlanStore';
import { InputStore } from './InputStore';
import { CycleStore } from './CycleStore';
import { CheckpointStore } from './CheckpointStore';
import { PeopleStore } from './PeopleStore';
import { EmployeeTeamStore } from './EmployeeTeamStore';
import { SkillStore } from './SkillStore';
import { ToolStore } from './ToolStore';
import { PolicyStore } from './PolicyStore';
import { QueueSettingsStore } from './QueueSettingsStore';
import { McpServerStore } from './McpServerStore';
import { ApprovalStore } from './ApprovalStore';
import { FindingStore } from './FindingStore';
import { ProposalStore } from './ProposalStore';
import { ScheduleStore } from './ScheduleStore';
import { WorkflowStore } from './WorkflowStore';
import { EventRuleStore } from './EventRuleStore';
import { ExecutionWindowStore } from './ExecutionWindowStore';
import {
  ProjectMcpManifest,
  defaultProjectMcpManifest,
  getProjectMcpPath,
  loadProjectMcp,
  saveProjectMcp
} from './projectMcp';

export interface Stores {
  runs: RunStore;
  events: EventStore;
  audit: AuditStore;
  plans: PlanStore;
  inputs: InputStore;
  cycles: CycleStore;
  checkpoints: CheckpointStore;
  people: PeopleStore;
  teams: EmployeeTeamStore;
  skills: SkillStore;
  tools: ToolStore;
  policy: PolicyStore;
  queue: QueueSettingsStore;
  mcpServers: McpServerStore;
  approvals: ApprovalStore;
  findings: FindingStore;
  proposals: ProposalStore;
  schedules: ScheduleStore;
  workflows: WorkflowStore;
  eventRules: EventRuleStore;
  executionWindows: ExecutionWindowStore;
}

export interface ProjectMcpFacade {
  path: string;
  load: () => ProjectMcpManifest | null;
  save: (manifest: ProjectMcpManifest) => void;
  defaultManifest: () => ProjectMcpManifest;
}

let activeStores: Stores | null = null;
let activeStoresRoot: string | undefined;

function resolveRoot(workspaceRoot?: string): string {
  if (workspaceRoot) return workspaceRoot;
  return getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
}

export function getStores(workspaceRoot?: string): Stores {
  const root = resolveRoot(workspaceRoot);
  if (!activeStores || root !== activeStoresRoot) {
    const people = new PeopleStore(root);
    activeStores = {
      runs: new RunStore(root),
      events: new EventStore(root),
      audit: new AuditStore(root),
      plans: new PlanStore(root),
      inputs: new InputStore(root),
      cycles: new CycleStore(root),
      checkpoints: new CheckpointStore(root),
      people,
      teams: new EmployeeTeamStore(root),
      skills: new SkillStore(root),
      tools: new ToolStore(root),
      policy: new PolicyStore(root),
      queue: new QueueSettingsStore(root),
      mcpServers: new McpServerStore(root),
      approvals: new ApprovalStore(root),
      findings: new FindingStore(root),
      proposals: new ProposalStore(root),
      schedules: new ScheduleStore(root),
      workflows: new WorkflowStore(root),
      eventRules: new EventRuleStore(root),
      executionWindows: new ExecutionWindowStore(root)
    };
    activeStoresRoot = root;
  }
  return activeStores;
}

export function getProjectMcpFile(workspaceRoot?: string): ProjectMcpFacade {
  const root = resolveRoot(workspaceRoot);
  return {
    path: getProjectMcpPath(root),
    load: () => loadProjectMcp(root),
    save: manifest => saveProjectMcp(manifest, root),
    defaultManifest: () => defaultProjectMcpManifest(root)
  };
}

export { ProjectMcpManifest } from './projectMcp';
