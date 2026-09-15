import { getStores } from '../../data/stores';
import { getDataService, DataService } from '../../data/DataService';
import { EventRecord, EventRule, EventRuleMatcher, EventRuleTrigger } from '../../data/types';
import { requireEmployeePermission } from './capabilityService';
import { executeWorkflow } from './workflow/engine';
import { emitEvent, setEventProcessor } from './events';

const MAX_RECENT_TRIGGERS = 10;

let processing = false;

export type RuleSkipReason = 'disabled' | 'non-matching' | 'already-triggered';

export interface RuleTriggerResult {
  ruleId: string;
  name: string;
  enabled: boolean;
  matched: boolean;
  triggered: boolean;
  workflowId: string;
  workflowName?: string;
  status?: EventRuleTrigger['status'];
  // v1.0 Slice D — event-rule workflows materialize Plans (createdPlanIds).
  createdPlanIds?: string[];
  skipReason?: RuleSkipReason;
  error?: string;
}

export interface ProcessEventRulesOptions {
  dataService?: DataService;
  stores?: ReturnType<typeof getStores>;
  now?: Date;
}

export interface EventRuleInput {
  name: string;
  description?: string;
  matcher: EventRuleMatcher;
  workflowId: string;
}

function requireRulePermission(actorId?: string): void {
  const gate = requireEmployeePermission('event-rule:manage', actorId);
  if (!gate.ok) {throw new Error(gate.error);}
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function sanitizeMatcher(matcher: EventRuleMatcher): EventRuleMatcher {
  const clean: EventRuleMatcher = {};
  for (const key of ['eventType', 'source', 'payloadKey', 'payloadValue'] as const) {
    const raw = matcher?.[key];
    const value = typeof raw === 'string' ? raw.trim() : undefined;
    if (value) {clean[key] = value;}
  }
  return clean;
}

function recordsAudit(action: string, targetId: string, details: Record<string, unknown>, actor?: string): void {
  getStores().audit.add({
    id: `audit_${Date.now()}`,
    actor: actor || 'system',
    action,
    targetType: 'eventRule',
    targetId,
    details,
    timestamp: new Date().toISOString()
  });
}

export function getEventRules(): EventRule[] {
  return getStores()
    .eventRules.loadAll()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function getEventRuleById(id: string): EventRule | undefined {
  return getStores().eventRules.getById(id);
}

export function createEventRule(input: EventRuleInput, actorId?: string): EventRule {
  requireRulePermission(actorId);

  const name = String(input.name || '').trim();
  if (!name) {throw new Error('Event rule name is required');}

  const workflow = getStores().workflows.getById(input.workflowId);
  if (!workflow) {throw new Error(`Workflow '${input.workflowId}' not found`);}

  const now = new Date();
  const rule: EventRule = {
    id: `eventrule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    enabled: true,
    matcher: sanitizeMatcher(input.matcher || {}),
    workflowId: workflow.id,
    workflowName: workflow.name,
    runCount: 0,
    recentTriggers: [],
    ...(String(input.description || '').trim() ? { description: String(input.description).trim() } : {}),
    createdAt: nowIso(now),
    updatedAt: nowIso(now)
  };
  getStores().eventRules.add(rule);
  recordsAudit('eventrule.created', rule.id, { name: rule.name, workflowId: rule.workflowId }, actorId);
  return rule;
}

export function updateEventRule(id: string, updates: { name?: string; description?: string; matcher?: EventRuleMatcher; workflowId?: string }, actorId?: string): EventRule {
  requireRulePermission(actorId);

  const rule = getStores().eventRules.getById(id);
  if (!rule) {throw new Error(`Event rule '${id}' not found`);}

  const merged: Partial<EventRule> = { updatedAt: nowIso(new Date()) };

  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name) {throw new Error('Event rule name is required');}
    merged.name = name;
  }
  if (updates.description !== undefined) {
    const description = String(updates.description || '').trim();
    merged.description = description || undefined;
  }
  if (updates.matcher !== undefined) {
    merged.matcher = sanitizeMatcher(updates.matcher || {});
  }
  if (updates.workflowId !== undefined) {
    const workflow = getStores().workflows.getById(updates.workflowId);
    if (!workflow) {throw new Error(`Workflow '${updates.workflowId}' not found`);}
    merged.workflowId = workflow.id;
    merged.workflowName = workflow.name;
  }

  getStores().eventRules.update(id, merged);
  recordsAudit('eventrule.updated', id, { name: merged.name, workflowId: merged.workflowId }, actorId);
  return getStores().eventRules.getById(id) as EventRule;
}

export function setEventRuleEnabled(id: string, enabled: boolean, actorId?: string): EventRule {
  requireRulePermission(actorId);

  const rule = getStores().eventRules.getById(id);
  if (!rule) {throw new Error(`Event rule '${id}' not found`);}

  getStores().eventRules.update(id, { enabled, updatedAt: nowIso(new Date()) });
  recordsAudit(enabled ? 'eventrule.enabled' : 'eventrule.disabled', id, { name: rule.name }, actorId);
  return getStores().eventRules.getById(id) as EventRule;
}

export function deleteEventRule(id: string, actorId?: string): boolean {
  requireRulePermission(actorId);

  const rule = getStores().eventRules.getById(id);
  if (!rule) {return false;}

  getStores().eventRules.delete(id);
  recordsAudit('eventrule.deleted', id, { name: rule.name }, actorId);
  return true;
}

function payloadValue(payload: Record<string, unknown>, key: string): unknown {
  let value: unknown = payload;
  for (const part of key.split('.')) {
    if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return value;
}

export function ruleMatches(rule: EventRule, event: EventRecord): boolean {
  const matcher = rule.matcher || {};

  const eventType = String(matcher.eventType || '').trim();
  if (eventType && eventType.toLowerCase() !== event.type.toLowerCase()) {
    return false;
  }

  const source = String(matcher.source || '').trim();
  if (source && source.toLowerCase() !== event.source.toLowerCase()) {
    return false;
  }

  const payloadKey = String(matcher.payloadKey || '').trim();
  if (payloadKey) {
    const value = payloadValue(event.payload, payloadKey);
    if (value === undefined) {
      return false;
    }
    const payloadValueText = String(matcher.payloadValue || '').trim();
    if (payloadValueText && String(value).trim().toLowerCase() !== payloadValueText.toLowerCase()) {
      return false;
    }
  }

  return true;
}

function recordTrigger(
  stores: ReturnType<typeof getStores>,
  rule: EventRule,
  event: EventRecord,
  status: EventRuleTrigger['status'],
  createdPlanIds: string[],
  workflowName?: string,
  error?: string
): void {
  const now = new Date().toISOString();
  const trigger: EventRuleTrigger = {
    eventId: event.id,
    eventType: event.type,
    workflowId: rule.workflowId,
    status,
    createdAt: now,
    ...(createdPlanIds.length > 0 ? { createdPlanIds } : {}),
    ...(error ? { error } : {})
  };

  stores.eventRules.update(rule.id, {
    runCount: (rule.runCount || 0) + 1,
    lastTriggeredAt: now,
    lastEventId: event.id,
    workflowName: workflowName || rule.workflowName,
    recentTriggers: [trigger, ...(rule.recentTriggers || [])].slice(0, MAX_RECENT_TRIGGERS),
    updatedAt: now
  });

  recordsAudit('eventrule.triggered', rule.id, {
    ruleName: rule.name,
    eventId: event.id,
    eventType: event.type,
    workflowId: rule.workflowId,
    status,
    ...(createdPlanIds.length > 0 ? { createdPlanIds } : {}),
    ...(error ? { error } : {})
  });
}

function collectPlanIds(result: { stepResults: Array<{ outputs: Record<string, unknown> }> }): string[] {
  const ids: string[] = [];
  for (const step of result.stepResults) {
    const planId = step.outputs?.planId;
    if (typeof planId === 'string' && planId && !ids.includes(planId)) {
      ids.push(planId);
    }
  }
  return ids;
}

export async function processEventRules(event: EventRecord, options: ProcessEventRulesOptions = {}): Promise<RuleTriggerResult[]> {
  if (processing) {
    return [];
  }
  processing = true;

  const results: RuleTriggerResult[] = [];

  try {
    const dataService = options.dataService ?? getDataService();
    const stores = options.stores ?? getStores(dataService.getWorkspaceRoot());

    const rules = stores.eventRules.loadAll().slice().sort((a, b) => a.id.localeCompare(b.id));

    for (const rule of rules) {
      const base: RuleTriggerResult = {
        ruleId: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        matched: false,
        triggered: false,
        workflowId: rule.workflowId,
        workflowName: rule.workflowName
      };

      if (!rule.enabled) {
        results.push({ ...base, skipReason: 'disabled' });
        continue;
      }

      const alreadyTriggered = (rule.recentTriggers || []).some(t => t.eventId === event.id);
      if (alreadyTriggered) {
        results.push({ ...base, matched: true, skipReason: 'already-triggered' });
        continue;
      }

      if (!ruleMatches(rule, event)) {
        results.push({ ...base, skipReason: 'non-matching' });
        continue;
      }

      const workflow = stores.workflows.getById(rule.workflowId);
      if (!workflow) {
        recordTrigger(stores, rule, event, 'failed', [], undefined, `workflow '${rule.workflowId}' not found`);
        results.push({
          ...base,
          matched: true,
          triggered: true,
          status: 'failed',
          error: `workflow '${rule.workflowId}' not found`
        });
        continue;
      }

      const runResult = await executeWorkflow(workflow, { stores, dataService });
      const createdPlanIds = collectPlanIds(runResult);
      recordTrigger(stores, rule, event, runResult.status, createdPlanIds, workflow.name, runResult.error);

      emitEvent('eventrule.fired', 'eventrule', {
        ruleId: rule.id,
        ruleName: rule.name,
        eventId: event.id,
        eventType: event.type,
        workflowId: workflow.id,
        status: runResult.status,
        ...(createdPlanIds.length > 0 ? { createdPlanIds } : {}),
        ...(runResult.error ? { error: runResult.error } : {})
      });

      results.push({
        ...base,
        matched: true,
        triggered: true,
        status: runResult.status,
        createdPlanIds,
        error: runResult.error,
        workflowName: workflow.name
      });
    }

    return results;
  } finally {
    processing = false;
  }
}

setEventProcessor((event) => {
  void processEventRules(event);
});