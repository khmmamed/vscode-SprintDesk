import { getStores } from '../../../data/stores';
import { Plan } from '../../../data/types';
import {
  commitStage,
  coreSections,
  hashParts,
  lastRecordFor,
  readSections,
  relayLoad,
  resolveStageMember
} from './stageSupport';

function renderExecutionPlan(plan: Plan, root: string): string {
  const lines = [
    `- Mode: ${plan.scheduling.mode}`,
    `- Status: ${plan.scheduling.status}`,
    `- Depends on: ${plan.scheduling.dependsOn.length > 0 ? plan.scheduling.dependsOn.join(', ') : 'None'}`
  ];
  if (plan.scheduling.scheduledAt) {
    lines.push(`- Scheduled at: ${plan.scheduling.scheduledAt}`);
  }
  const agent = plan.execution.assignedAgent
    ? getStores(root).people.getById(plan.execution.assignedAgent)
    : undefined;
  lines.push(`- Execution agent: ${agent ? `${agent.name} (${agent.id})` : 'unassigned'}`);
  return lines.join('\n');
}

// Scheduler stage — the terminal registry decision is rendered into the artifact.
// Scheduling is authoritative registry state (never invented by a model), so this
// stage is deterministic; it marks the plan `ready` once scheduling reports ready.
export async function runSchedulerStage(plan: Plan, root: string): Promise<Plan> {
  const sections = readSections(plan, root);
  const hash = hashParts([
    coreSections(sections),
    plan.classification.current,
    plan.scheduling.status,
    plan.scheduling.mode,
    plan.scheduling.dependsOn,
    plan.scheduling.scheduledAt,
    plan.execution.assignedAgent
  ]);
  if (lastRecordFor(plan, ['scheduler', 'ready'])?.hash === hash) {
    return plan;
  }

  const ready = plan.scheduling.status === 'ready';
  const member = resolveStageMember('scheduler', root);
  const committed = commitStage({
    plan,
    root,
    stage: ready ? 'ready' : 'scheduler',
    source: 'deterministic',
    ...(member.id ? { memberId: member.id } : {}),
    hash,
    sections: [{ key: 'executionPlan', value: renderExecutionPlan(plan, root) }],
    registryPatch: {}
  });
  return relayLoad(committed.id, root) || committed;
}
