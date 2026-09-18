import { getStores } from '../../../data/stores';
import { Plan } from '../../../data/types';
import { runOrganizerPass } from '../plan/organizer';
import { PlanMdSections } from '../plan/planService';
import {
  commitStage,
  coreSections,
  hashParts,
  lastRecord,
  readSections,
  relayLoad,
  resolveStageMember,
  runLlmText
} from './stageSupport';

const BREAKDOWN_SYSTEM_PROMPT = [
  'Rewrite the plan as a concrete, ordered implementation checklist.',
  'Respond with markdown list items only (e.g. "1. ...", "2. ...").',
  'Do not include a heading, preamble, or any text outside the list.'
].join(' ');

export interface OrganizerStageResult {
  plan: Plan;
  organizer: { ran: boolean; examined: number; changed: number };
}

function organizerHash(plan: Plan, sections: PlanMdSections): string {
  return hashParts([
    coreSections(sections),
    plan.classification.current,
    plan.scheduling.status,
    plan.scheduling.mode,
    plan.scheduling.dependsOn,
    plan.execution.status,
    plan.execution.assignedAgent
  ]);
}

function deterministicBreakdown(sections: PlanMdSections): string {
  const implementation = (sections.implementation || '').trim();
  const rawItems = implementation
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^(?:[-*]|\d+[.)])\s+/, ''));
  const steps = rawItems.length > 1 ? rawItems : [implementation || sections.objective];
  const lines = steps.filter(Boolean).map((step, index) => `${index + 1}. ${step}`);
  if (sections.acceptanceCriteria?.trim()) {
    lines.push('', `Acceptance: ${sections.acceptanceCriteria.trim()}`);
  }
  return lines.join('\n');
}

function renderDependencies(plan: Plan): string {
  const refs = [...new Set(plan.scheduling.dependsOn)].sort();
  return refs.length > 0 ? refs.map(ref => `- ${ref}`).join('\n') : 'None';
}

function renderAssignment(plan: Plan, root: string): string {
  const lines: string[] = [];
  const agent = plan.execution.assignedAgent
    ? getStores(root).people.getById(plan.execution.assignedAgent)
    : undefined;
  lines.push(agent ? `- Agent: ${agent.name} (${agent.id})` : '- Agent: unassigned');
  lines.push(`- Status: ${plan.execution.status}`);
  const reason = plan.execution.assignmentReason
    ? `capability [${plan.execution.assignmentReason.capability.join(', ')}], availability ${plan.execution.assignmentReason.availability}, workload ${plan.execution.assignmentReason.workload}`
    : plan.organization.decisionReason || 'awaiting a capable agent';
  lines.push(`- Reason: ${reason}`);
  return lines.join('\n');
}

// Organizer stage — reconciles the registry (dependencies, runnability,
// assignment) via the existing pass, then reflects that decision into the plan
// artifact as Breakdown / Dependencies / Assignment sections. The pass is skipped
// when neither the content nor the registry inputs changed, so a steady-state
// intake tick emits nothing.
export async function runOrganizerStage(plan: Plan, root: string): Promise<OrganizerStageResult> {
  const preSections = readSections(plan, root);
  if (lastRecord(plan, 'organizer')?.hash === organizerHash(plan, preSections)) {
    return { plan, organizer: { ran: false, examined: 0, changed: 0 } };
  }

  const pass = runOrganizerPass({ workspaceRoot: root, planIds: [plan.id] });
  const current = relayLoad(plan.id, root) || plan;
  const sections = readSections(current, root);
  const member = resolveStageMember('organizer', root);

  let breakdown = deterministicBreakdown(sections);
  let source: 'deterministic' | 'llm' = 'deterministic';
  if (member.profile) {
    const context = [
      `Objective: ${sections.objective}`,
      sections.implementation ? `Implementation: ${sections.implementation}` : '',
      sections.acceptanceCriteria ? `Acceptance criteria: ${sections.acceptanceCriteria}` : ''
    ].filter(Boolean).join('\n');
    const output = await runLlmText(member.profile, BREAKDOWN_SYSTEM_PROMPT, context);
    if (output) {
      breakdown = output;
      source = 'llm';
    }
  }

  const committed = commitStage({
    plan: current,
    root,
    stage: 'organizer',
    source,
    ...(member.id ? { memberId: member.id } : {}),
    hash: organizerHash(current, sections),
    sections: [
      { key: 'breakdown', value: breakdown },
      { key: 'dependencies', value: renderDependencies(current) },
      { key: 'assignment', value: renderAssignment(current, root) }
    ],
    // Registry decisions were already applied by runOrganizerPass.
    registryPatch: {}
  });

  return {
    plan: committed,
    organizer: { ran: true, examined: pass.examined, changed: pass.changed }
  };
}
