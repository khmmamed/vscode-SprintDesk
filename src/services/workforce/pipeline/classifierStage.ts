import { analyzeContent } from '../plan/organizer';
import {
  Plan,
  PlanCategory,
  PlanClassificationAxis,
  PlanClassificationCurrent,
  PlanComplexity,
  PlanExecutionMode,
  PlanPriority,
  PlanRisk,
  PlanUrgency
} from '../../../data/types';
import {
  commitStage,
  hashParts,
  lastRecord,
  readSections,
  resolveStageMember,
  runLlmText,
  StageMember
} from './stageSupport';

const CATEGORIES: readonly PlanCategory[] = [
  'feature', 'bug', 'improvement', 'refactor', 'research',
  'documentation', 'test', 'maintenance', 'security', 'infrastructure', 'data'
];
const URGENCIES: readonly PlanUrgency[] = ['emergency', 'urgent', 'normal', 'low', 'scheduled'];
const PRIORITIES: readonly PlanPriority[] = ['critical', 'high', 'medium', 'low'];
const LEVELS: readonly (PlanComplexity & PlanRisk)[] = ['low', 'medium', 'high'];
const MODES: readonly PlanExecutionMode[] = ['immediate', 'async', 'sync', 'scheduled', 'blocked'];

const CLASSIFY_SYSTEM_PROMPT = [
  'You classify a software plan. Respond with a single JSON object only, of the shape:',
  '{"category":"feature"|"bug"|"improvement"|"refactor"|"research"|"documentation"|"test"|"maintenance"|"security"|"infrastructure"|"data",',
  '"urgency":"emergency"|"urgent"|"normal"|"low"|"scheduled", "priority":"critical"|"high"|"medium"|"low",',
  '"complexity":"low"|"medium"|"high", "risk":"low"|"medium"|"high",',
  '"executionMode":"immediate"|"async"|"sync"|"scheduled"|"blocked", "reason": string}.',
  'Omit any axis you cannot infer. Do not include text outside the JSON object.'
].join(' ');

function pickAxis(source: Record<string, unknown>): Partial<PlanClassificationAxis> {
  const axis: Partial<PlanClassificationAxis> = {};
  if (typeof source.category === 'string' && CATEGORIES.includes(source.category as PlanCategory)) {
    axis.category = source.category as PlanCategory;
  }
  if (typeof source.urgency === 'string' && URGENCIES.includes(source.urgency as PlanUrgency)) {
    axis.urgency = source.urgency as PlanUrgency;
  }
  if (typeof source.priority === 'string' && PRIORITIES.includes(source.priority as PlanPriority)) {
    axis.priority = source.priority as PlanPriority;
  }
  if (typeof source.complexity === 'string' && LEVELS.includes(source.complexity as PlanComplexity)) {
    axis.complexity = source.complexity as PlanComplexity;
  }
  if (typeof source.risk === 'string' && LEVELS.includes(source.risk as PlanRisk)) {
    axis.risk = source.risk as PlanRisk;
  }
  if (typeof source.executionMode === 'string' && MODES.includes(source.executionMode as PlanExecutionMode)) {
    axis.executionMode = source.executionMode as PlanExecutionMode;
  }
  return axis;
}

interface LlmClassification {
  axis: Partial<PlanClassificationAxis>;
  reason?: string;
}

function parseLlmClassification(output: string): LlmClassification | undefined {
  const match = output.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!match) {
    return undefined;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const axis = pickAxis(parsed);
  const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : undefined;
  if (Object.keys(axis).length === 0 && !reason) {
    return undefined;
  }
  return { axis, ...(reason ? { reason } : {}) };
}

function renderClassification(current: PlanClassificationCurrent): string {
  const lines = [
    `- Category: ${current.category}`,
    `- Urgency: ${current.urgency}`,
    `- Priority: ${current.priority}`,
    `- Complexity: ${current.complexity}`,
    `- Risk: ${current.risk}`,
    `- Execution mode: ${current.executionMode}`,
    `- Classified by: ${current.classifiedBy.id}`
  ];
  if (current.reason) {
    lines.push(`- Reason: ${current.reason}`);
  }
  return lines.join('\n');
}

// Classifier stage — determines the six-axis classification and records it both in
// the registry (classification.current) and as a `## Classification` section.
// Deterministic evidence is the baseline; an assigned classifier agent's model may
// override axes, and any failure falls back to the deterministic result.
export async function runClassifierStage(plan: Plan, root: string): Promise<Plan> {
  const sections = readSections(plan, root);
  const member: StageMember = resolveStageMember('classifier', root);
  const semantics = analyzeContent(sections);
  const original = plan.classification.original;

  let axis: Partial<PlanClassificationAxis> = { ...semantics.evidence };
  let reason = semantics.axisReasons.join('; ');
  let source: 'deterministic' | 'llm' = 'deterministic';

  if (member.profile) {
    const context = [
      `Objective: ${sections.objective}`,
      sections.implementation ? `Implementation: ${sections.implementation}` : '',
      sections.acceptanceCriteria ? `Acceptance criteria: ${sections.acceptanceCriteria}` : '',
      sections.constraints ? `Constraints: ${sections.constraints}` : ''
    ].filter(Boolean).join('\n');
    const output = await runLlmText(member.profile, CLASSIFY_SYSTEM_PROMPT, context);
    const llm = output ? parseLlmClassification(output) : undefined;
    if (llm) {
      axis = { ...axis, ...llm.axis };
      reason = llm.reason || reason;
      source = 'llm';
    }
  }

  const hash = hashParts([
    sections.objective,
    sections.implementation,
    sections.acceptanceCriteria,
    sections.constraints,
    original
  ]);
  if (lastRecord(plan, 'classifier')?.hash === hash) {
    return plan;
  }

  const current: PlanClassificationCurrent = {
    ...original,
    ...axis,
    ...(reason ? { reason } : {}),
    classifiedBy: { type: 'agent', id: member.id || 'classifier' }
  };

  return commitStage({
    plan,
    root,
    stage: 'classifier',
    source,
    ...(member.id ? { memberId: member.id } : {}),
    hash,
    sections: [{ key: 'classification', value: renderClassification(current) }],
    registryPatch: { classification: { original, current } }
  });
}
