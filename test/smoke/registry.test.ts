import { strict as assert } from 'node:assert';
import { ALL_TOOLS, getAllToolNames } from '../../src/mcp/tools';
import { HANDLERS } from '../../src/mcp/handlers';
import { buildMcpManifest, buildMcpReadme } from '../../src/mcp/manifest';

describe('MCP tool registry hygiene', () => {
  it('exposes unique tool names', () => {
    const names = getAllToolNames();
    assert.strictEqual(new Set(names).size, names.length);
  });

  it('every tool in ALL_TOOLS carries a name, description and inputSchema', () => {
    for (const tool of ALL_TOOLS) {
      assert.ok(tool.name, 'tool missing name');
      assert.ok(tool.description, `missing description: ${tool.name}`);
      assert.ok(tool.inputSchema, `missing inputSchema: ${tool.name}`);
    }
  });

  it('every registered tool has an implementable handler', () => {
    for (const tool of ALL_TOOLS) {
      assert.ok(HANDLERS[tool.name], `no handler for ${tool.name}`);
    }
  });

  it('every handler is discoverable (no orphan handlers)', () => {
    const registered = new Set(getAllToolNames());
    for (const name of Object.keys(HANDLERS)) {
      assert.ok(registered.has(name), `orphan handler not in ALL_TOOLS: ${name}`);
    }
  });

  it('the generated manifest covers ALL_TOOLS exactly', () => {
    const manifest = buildMcpManifest();
    const manifestTools = (Object.values(manifest.tools as Record<string, string[]>)).flat().sort();
    const registry = getAllToolNames().sort();
    assert.deepStrictEqual(manifestTools, registry);
    assert.strictEqual(manifest.toolCount, registry.length);
  });

  it('the generated README documents every registered tool exactly once', () => {
    const readme = buildMcpReadme();
    for (const name of getAllToolNames()) {
      const mentions = readme.split(`\`${name}\``).length - 1;
      assert.strictEqual(mentions, 1, `README should document ${name} exactly once, found ${mentions}`);
    }
  });
});