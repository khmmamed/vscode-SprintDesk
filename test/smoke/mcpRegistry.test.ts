import { strict as assert } from 'node:assert';
import { makeWorkspace, makeEmployee, makeAgentConfig, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { upsertMcpServer, removeMcpServer, listMcpServers, isServerEnabled, getMcpServer } from '../../src/services/workforce/mcp/registry';
import { canCallTool, canListTools, hasCapability, requireCall, resolveEmployee } from '../../src/services/workforce/mcp/safety';
import { callServerTool, listServerTools } from '../../src/services/workforce/mcp/client';
import { DEFAULT_POLICY } from '../../src/data/types';

describe('MCP registry + safety chain', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
    upsertMcpServer({ id: 'fs', kind: 'stdio', command: 'node', args: ['server.js'], enabled: true });
    upsertMcpServer({ id: 'web', kind: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true });
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('registers, lists, reads and removes servers', () => {
    assert.strictEqual(listMcpServers().length, 2);
    assert.strictEqual(getMcpServer('fs')?.kind, 'stdio');
    assert.strictEqual(isServerEnabled('fs'), true);
    assert.strictEqual(removeMcpServer('fs'), true);
    assert.strictEqual(getMcpServer('fs'), undefined);
  });

  it('surfaces compound capability ids', () => {
    const granted = makeEmployee({ name: 'Granted', capabilities: ['mcp.web.list'] });
    assert.strictEqual(hasCapability(granted, 'mcp.web.list'), true);
    assert.strictEqual(hasCapability(granted, 'mcp.web.other'), false);

    const wildcardServer = makeEmployee({ name: 'Wildcard', capabilities: ['mcp.web.*'] });
    assert.strictEqual(hasCapability(wildcardServer, 'mcp.web.run_x'), true);
    assert.strictEqual(hasCapability(wildcardServer, 'mcp.fs.run_x'), false);

    const global = makeEmployee({ name: 'Global', capabilities: ['mcp.*'] });
    assert.strictEqual(hasCapability(global, 'mcp.fs.run_x'), true);
  });

  it('denies calls without the tool-level capability', () => {
    const agent = makeEmployee({ name: 'Restricted', role: 'agent' });
    getStores().people.add(agent);
    const gate = canCallTool(agent as any, 'web', 'list');
    assert.strictEqual(gate.ok, false);
    assert.match((gate as { error: string }).error, /lacks capability 'mcp\.web\.list'/);
  });

  it('denies calls to unknown or disabled servers', () => {
    const agent = makeEmployee({ name: 'Agent', role: 'agent', capabilities: ['mcp.bogus.list'] });
    const gate = canCallTool(agent as any, 'bogus', 'list');
    assert.strictEqual(gate.ok, false);
    assert.match((gate as { error: string }).error, /not registered/);

    upsertMcpServer({ id: 'fs', kind: 'stdio', command: 'node', args: ['x'], enabled: false });
    const watcher = makeEmployee({ name: 'Watcher', role: 'agent', capabilities: ['mcp.fs.list'] });
    assert.strictEqual(isServerEnabled('fs'), false);
    const disabled = canCallTool(watcher as any, 'fs', 'list');
    assert.strictEqual(disabled.ok, false);
    assert.match((disabled as { error: string }).error, /disabled/);
  });

  it('allows a call when policy and capability are granted', () => {
    const agent = makeEmployee({ name: 'Authorized', role: 'agent', capabilities: ['mcp.web.list'] });
    getStores().people.add(agent);
    assert.strictEqual(canListTools(agent, 'web').ok, true);
    const call = canCallTool(agent, 'web', 'list');
    assert.strictEqual(call.ok, true);
  });

  it('deny wins over an allow override', () => {
    const employee = makeEmployee({ name: 'Denied', role: 'agent', capabilities: ['mcp.web.list'] });
    getStores().people.add(employee);
    getStores().policy.save({
      ...DEFAULT_POLICY,
      overrides: [{ employeeId: employee.id, deny: ['mcp:call'] }]
    });
    const gate = canCallTool(employee, 'web', 'list');
    assert.strictEqual(gate.ok, false);
    assert.match((gate as { error: string }).error, /lacks permission 'mcp:call'/);
  });

  it('resolveEmployee finds employees by id or name', () => {
    const employee = makeEmployee({ name: 'Bobby' });
    getStores().people.add(employee);
    const byId = resolveEmployee(employee.id);
    const byName = resolveEmployee('Bobby');
    assert.strictEqual(byId?.id, employee.id);
    assert.strictEqual(byName?.id, employee.id);
    assert.strictEqual(resolveEmployee('nobody'), undefined);
  });

  it('listServerTools runs the full chain and denies when the list capability is missing', async () => {
    const agent = makeEmployee({ name: 'Chained', role: 'agent', capabilities: ['mcp.web.other'] });
    getStores().people.add(agent);

    await assert.rejects(
      () => listServerTools('web', agent.name),
      /mcp\.web\.list/ // capability id required for listing
    );

    const agentWithList = makeEmployee({ name: 'Chained2', role: 'agent', capabilities: ['mcp.web.list'] });
    getStores().people.add(agentWithList);
    const gate = requireCall(agentWithList.name, 'web', 'list');
    assert.strictEqual(gate.ok, true);
  });

  it('throws a friendly error when the client cannot reach a server', async () => {
    const agent = makeEmployee({ name: 'NoNet', role: 'agent', capabilities: ['mcp.web.list'] });
    getStores().people.add(agent);
    await assert.rejects(
      () => callServerTool('web', 'list', {}, { agentIdOrName: agent.name }),
      (err: unknown) => (err as Error).message.includes('ECONNREFUSED') || (err as Error).message.includes('connection')
    );
  });

  it('agent default policy includes mcp:list and mcp:call', () => {
    assert.ok(DEFAULT_POLICY.roles.agent.includes('mcp:list'));
    assert.ok(DEFAULT_POLICY.roles.agent.includes('mcp:call'));
    assert.ok(DEFAULT_POLICY.roles.lead.includes('mcp:call'));
  });
});