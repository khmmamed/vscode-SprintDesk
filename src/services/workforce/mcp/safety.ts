import { getStores } from '../../../data/stores';
import { Employee } from '../../../data/types';
import { hasEmployeePermission } from '../capabilityService';
import { getMcpServer, isServerEnabled } from './registry';

export type McpGate =
  | { ok: true }
  | { ok: false; error: string };

export function hasCapability(employee: Employee, capabilityId: string): boolean {
  const caps = employee.capabilities || [];
  if (caps.includes(capabilityId)) {
    return true;
  }
  const parts = capabilityId.split('.');
  const server = parts[1];
  if (server) {
    if (caps.includes(`mcp.${server}.*`)) {
      return true;
    }
  }
  if (caps.includes('mcp.*')) {
    return true;
  }
  return false;
}

export function canCallTool(employee: Employee, serverId: string, toolName: string): McpGate {
  if (!getMcpServer(serverId)) {
    return { ok: false, error: `mcp server not registered: ${serverId}` };
  }
  if (!isServerEnabled(serverId)) {
    return { ok: false, error: `mcp server disabled: ${serverId}` };
  }
  if (!hasEmployeePermission(employee, 'mcp:call')) {
    return { ok: false, error: `employee ${employee.name} lacks permission 'mcp:call'` };
  }
  const capabilityId = `mcp.${serverId}.${toolName}`;
  if (!hasCapability(employee, capabilityId)) {
    return { ok: false, error: `employee ${employee.name} lacks capability '${capabilityId}'` };
  }
  return { ok: true };
}

export function canListTools(employee: Employee, serverId: string): McpGate {
  if (!getMcpServer(serverId)) {
    return { ok: false, error: `mcp server not registered: ${serverId}` };
  }
  if (!isServerEnabled(serverId)) {
    return { ok: false, error: `mcp server disabled: ${serverId}` };
  }
  if (!hasEmployeePermission(employee, 'mcp:list')) {
    return { ok: false, error: `employee ${employee.name} lacks permission 'mcp:list'` };
  }
  const capabilityId = `mcp.${serverId}.list`;
  if (!hasCapability(employee, capabilityId)) {
    return { ok: false, error: `employee ${employee.name} lacks capability '${capabilityId}'` };
  }
  return { ok: true };
}

export function resolveEmployee(agentIdOrName?: string): Employee | undefined {
  if (!agentIdOrName) {
    return undefined;
  }
  return getStores()
    .people.loadAll()
    .find(e => e.id === agentIdOrName || e.name === agentIdOrName);
}

export function requireCall(agentIdOrName: string | undefined, serverId: string, toolName: string): McpGate {
  if (!agentIdOrName) {
    return { ok: false, error: 'no agent context (employee id or name) supplied for mcp call' };
  }
  const employee = resolveEmployee(agentIdOrName);
  if (!employee) {
    return { ok: false, error: `unknown employee: ${agentIdOrName}` };
  }
  return canCallTool(employee, serverId, toolName);
}

export function requireList(agentIdOrName: string | undefined, serverId: string): McpGate {
  if (!agentIdOrName) {
    return { ok: false, error: 'no agent context (employee id or name) supplied for mcp list' };
  }
  const employee = resolveEmployee(agentIdOrName);
  if (!employee) {
    return { ok: false, error: `unknown employee: ${agentIdOrName}` };
  }
  return canListTools(employee, serverId);
}