import { getStores } from '../../data/stores';
import { Employee, Finding, FindingSeverity, FindingStatus, Run, Task } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import { emitEvent } from './events';

export type FindingDecision = 'approved' | 'rejected';

const FINDING_HEADER = /^findings:?\s*$/i;
const ERRORS_HEADER = /^errors:?\s*$/i;
const BULLET_LINE = /^\s*[-*•]|\s*\d+[.)]\s/;
const SEVERITY_TAG = /\[(low|medium|high)\]\s*/i;

function normalizeBullet(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+?|\s*\d+[.)]\s/, '')
    .replace(SEVERITY_TAG, '')
    .trim();
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function extractFindingBullets(output?: string): Array<{ title: string; severity: FindingSeverity }> {
  const lines = (output || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const findingsIdx = lines.findIndex(l => FINDING_HEADER.test(l));
  if (findingsIdx === -1) {return [];}

  const errorsIdx = lines.findIndex((l, i) => i > findingsIdx && ERRORS_HEADER.test(l));
  const sectionEnd = errorsIdx !== -1 ? errorsIdx : lines.length;

  return lines
    .slice(findingsIdx + 1, sectionEnd)
    .filter(l => BULLET_LINE.test(l))
    .map(l => {
      const raw = normalizeBullet(l);
      const tag = l.match(SEVERITY_TAG);
      return { title: raw, severity: (tag ? tag[1].toLowerCase() : 'medium') as FindingSeverity };
    })
    .filter(b => b.title.length > 0);
}

export function findingIdentity(runId: string, bullet: { title: string; severity: FindingSeverity }): string {
  return `finding_${runId}_${hashText(`${bullet.severity}:${bullet.title}`.toLowerCase())}`;
}

export interface CreateFindingInput {
  title: string;
  runId: string;
  agent: string;
  agentName?: string;
  taskId?: string;
  severity?: FindingSeverity;
  confidence?: number;
  category?: string;
  suggestedTaskType?: Task['type'];
  suggestedWorkflow?: string;
  suggestedPriority?: Task['priority'];
  evidence?: string;
  sourceType?: string;
}

export function createFinding(input: CreateFindingInput): Finding {
  const now = new Date().toISOString();
  const severity = input.severity || 'medium';
  const finding: Finding = {
    id: findingIdentity(input.runId, { title: input.title, severity }),
    title: input.title,
    source: { runId: input.runId, type: input.sourceType || 'run-output' },
    agent: input.agent,
    agentName: input.agentName,
    timestamp: now,
    severity,
    status: 'pending',
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.suggestedTaskType ? { suggestedTaskType: input.suggestedTaskType } : {}),
    ...(input.suggestedWorkflow ? { suggestedWorkflow: input.suggestedWorkflow } : {}),
    ...(input.suggestedPriority ? { suggestedPriority: input.suggestedPriority } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {})
  };

  if (!getStores().findings.getById(finding.id)) {
    getStores().findings.add(finding);
    emitEvent('finding.created', 'findings', {
      findingId: finding.id,
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agent,
      severity: finding.severity,
      status: finding.status
    });
  }

  return getStores().findings.getById(finding.id) || finding;
}

export function materializeFindings(runId: string): Finding[] {
  const run = getStores().runs.getById(runId);
  if (!run || !run.result) {return [];}

  const employee = run.agentId ? getStores().employees.getById(run.agentId) : undefined;
  const bullets = extractFindingBullets(run.result);

  return bullets.map(b => createFinding({
    title: b.title,
    severity: b.severity,
    runId: run.id,
    agent: employee?.id || run.agentId || 'unknown',
    agentName: employee?.name,
    taskId: run.taskId,
    evidence: b.title,
    sourceType: 'run-output'
  }));
}

export function allFindings(limit?: number): Finding[] {
  const all = getStores().findings.loadAll().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function findingsByStatus(status: FindingStatus, limit?: number): Finding[] {
  const all = getStores().findings.byStatus(status).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function pendingFindings(limit?: number): Finding[] {
  const all = getStores().findings.pending().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return limit === undefined ? all : all.slice(0, limit);
}

export function pendingFindingCount(): number {
  return getStores().findings.pending().length;
}

export function updateStatus(findingId: string, decision: FindingDecision, actorId?: string): Finding | undefined {
  const finding = getStores().findings.getById(findingId);
  if (!finding || finding.status !== 'pending') {return undefined;}

  const gate = requireEmployeePermission('approval:review', actorId);
  if (!gate.ok) {throw new Error(gate.error);}

  const now = new Date().toISOString();
  getStores().findings.update(findingId, {
    status: decision,
    resolvedAt: now,
    decisionBy: actorId
  });

  emitEvent('finding.resolved', 'findings', {
    findingId,
    runId: finding.source?.runId,
    taskId: finding.taskId,
    agentId: finding.agent,
    status: decision,
    decisionBy: actorId
  });

  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actorId || 'system',
    action: `finding.${decision}`,
    targetType: 'finding',
    targetId: findingId,
    details: { runId: finding.source?.runId, taskId: finding.taskId, severity: finding.severity },
    timestamp: now
  });

  return getStores().findings.getById(findingId);
}

export function resolveEmployeeForRun(run: Run): Employee | undefined {
  return run.agentId ? getStores().employees.getById(run.agentId) : undefined;
}

export interface FindingSummary {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export function getFindingSummary(): FindingSummary {
  const total = getStores().findings.loadAll();
  return {
    pending: total.filter(f => f.status === 'pending').length,
    approved: total.filter(f => f.status === 'approved').length,
    rejected: total.filter(f => f.status === 'rejected').length,
    total: total.length
  };
}