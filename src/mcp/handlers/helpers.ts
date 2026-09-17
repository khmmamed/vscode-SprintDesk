import * as fileService from '../../services/fileService';
import { getStores } from '../../data/stores';
import { AuditEntry } from '../../data/types';

export interface HandlerResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type Handler = (args: any) => HandlerResult | Promise<HandlerResult>;

export function res(text: string, isError = false): HandlerResult {
  return { content: [{ type: 'text', text }], isError };
}

export function getWs(): string | undefined {
  return fileService.getWorkspaceRoot();
}

export interface ResolvedAgent {
  id: string;
  name: string;
  source: 'people';
  role: 'agent' | 'human';
  status?: string;
}

export function resolveAgent(agentIdOrName?: string): ResolvedAgent | undefined {
  if (!agentIdOrName) return undefined;

  const workforceEmployee = getStores().people
    .loadAll()
    .find(e => e.id === agentIdOrName || e.name === agentIdOrName);
  if (workforceEmployee) {
    return {
      id: workforceEmployee.id,
      name: workforceEmployee.name,
      source: 'people',
      role: workforceEmployee.role,
      status: workforceEmployee.status
    };
  }

  return undefined;
}

export function recordAudit(entry: Partial<AuditEntry> & { actor: string; action: string; targetType: string }): AuditEntry {
  const auditEntry: AuditEntry = {
    id: `audit_${Date.now()}`,
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details,
    timestamp: new Date().toISOString()
  };
  getStores().audit.add(auditEntry);
  return auditEntry;
}
