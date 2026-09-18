import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildMcpManifest, buildMcpReadme } from '../../src/mcp/manifest';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
      if (parsed.name === 'vscode-sprintdesk') {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`could not locate repo root from ${start}`);
}

const repoRoot = findRepoRoot(__dirname);

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('documentation consistency (v1.0.0)', () => {
  it('package.json version matches the latest released CHANGELOG heading', () => {
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    const headings = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/gm) || [];
    const first = headings[0];
    assert.ok(first, 'CHANGELOG must have at least one released version heading');
    const latest = first.replace(/^## \[|\]$/g, '');
    assert.equal(version, latest, 'package.json version must match the newest CHANGELOG release');
  });

  it('CHANGELOG records the v1.0 Plan-native replatform (slices A-R)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^## \[1\.0\.0\]/m, 'CHANGELOG must contain a [1.0.0] release section');
    assert.doesNotMatch(changelog, /^## \[Unreleased\]/m, 'release content must not remain under [Unreleased]');
    for (const slice of 'ABCDEFGHIJKLMNOPQR'.split('')) {
      assert.match(
        changelog,
        new RegExp(`^### v1\\.0 Slice ${slice} `, 'm'),
        `CHANGELOG must document v1.0 Slice ${slice}`
      );
    }
    // v0.12 entries are kept as history, never dropped.
    for (const slice of 'ABCDEFGH'.split('')) {
      assert.match(
        changelog,
        new RegExp(`^### v0\\.12 Slice ${slice} `, 'm'),
        `CHANGELOG must retain v0.12 Slice ${slice} history`
      );
    }
  });

  it('current-features.md describes the Plan-native architecture and drops legacy storage paths', () => {
    const doc = read('docs/current-features.md');
    assert.match(doc, /Plan-native/, 'current-features must be Plan-native');
    assert.match(doc, /\.SprintDesk\/database\//, 'current-features must document the database/ storage boundary');
    assert.doesNotMatch(doc, /\.SprintDesk\/data\/runs\.yml/, 'legacy runs.yml path must be gone');
    assert.doesNotMatch(doc, /\.SprintDesk\/workforce\//, 'legacy workforce/ state root must be gone');
    assert.doesNotMatch(doc, /### 📋 Task Management/, 'legacy Task Management feature section must be gone');
    assert.doesNotMatch(doc, /### 📊 Project Organization/, 'legacy Epic/Backlog organization section must be gone');
    assert.doesNotMatch(doc, /### 🔄 Sprint Management/, 'legacy Sprint Management section must be gone');
    assert.doesNotMatch(doc, /### 📈 Epic Management/, 'legacy Epic Management section must be gone');
  });

  it('README describes the Plan-native workflow and references current docs', () => {
    const readme = read('README.md');
    assert.match(readme, /plan-native/i, 'README must describe the Plan-native architecture');
    assert.match(readme, /\.SprintDesk\/database\//, 'README must document the database/ storage boundary');
    assert.doesNotMatch(readme, /\.SprintDesk\/workforce\//, 'README must not reference the removed workforce/ root');
    assert.doesNotMatch(readme, /docs\/v0\.11-upcomming\.md/, 'README must point at current docs, not v0.11');
    assert.doesNotMatch(readme, /sprintdesk\.taskPrefix/, 'README must not document dead legacy settings');
  });

  it('every v0.12 document carries the historical-status note', () => {
    const docsDir = path.join(repoRoot, 'docs');
    const v012 = fs.readdirSync(docsDir).filter((f) => f.startsWith('v0.12-') && f.endsWith('.md'));
    assert.ok(v012.length >= 3, 'expected the v0.12 documents to be present');
    for (const file of v012) {
      assert.match(
        fs.readFileSync(path.join(docsDir, file), 'utf8'),
        /Historical status \(v1\.0\.0\)/,
        `docs/${file} must carry the historical-status note`
      );
    }
  });

  it('the workflow DSL is plan-native end to end (no legacy task step contract)', () => {
    const types = read('src/data/types.ts');
    assert.match(types, /export type WorkflowStepType = 'plan' \| 'loop' \| 'tool' \| 'condition';/);
    assert.match(types, /export interface WorkflowPlanStep extends WorkflowBaseStep \{/);
    assert.doesNotMatch(types, /WorkflowTaskStep/, 'the old WorkflowTaskStep type must be gone');

    const workflow = ['src/services/workforce/workflow/engine.ts', 'src/services/workforce/workflow/dsl.ts']
      .map(read)
      .join('\n');
    assert.doesNotMatch(workflow, /taskType/, 'the workflow engine/DSL must not use taskType');
    assert.doesNotMatch(workflow, /type: 'task'/, 'the workflow engine/DSL must not use a task step');
    assert.doesNotMatch(workflow, /executeTaskStep/, 'the task-step executor must be renamed');

    const docs = `${read('README.md')}\n${read('docs/current-features.md')}`;
    assert.doesNotMatch(docs, /`task` \/ `loop`/, 'docs must describe the plan / loop / tool / condition DSL');
  });

  it('removes the dead legacy Epic interface (Slice S)', () => {
    const types = read('src/data/types.ts');
    assert.doesNotMatch(types, /export interface Epic \{/, 'the unused Epic interface must stay removed');
  });

  it('the extension manifest declares no legacy sprintdesk.* settings (Slice N)', () => {
    const pkg = JSON.parse(read('package.json')) as {
      contributes?: { configuration?: { properties?: Record<string, unknown> } };
    };
    const props = pkg.contributes?.configuration?.properties ?? {};
    const legacy = Object.keys(props).filter((key) => key.startsWith('sprintdesk.'));
    assert.deepEqual(legacy, [], `legacy sprintdesk.* settings must be removed, found: ${legacy.join(', ')}`);
  });

  it('the v1.0.0 proposal is implemented and records the resolved migration decision', () => {
    const proposal = read('docs/v1.0.0-proposal.md');
    assert.match(proposal, /Status: implemented \(v1\.0\.0\)/, 'proposal must be marked implemented');
    assert.match(proposal, /no Task→Plan migration/i, 'proposal must record that no Task→Plan migration ships');
    assert.doesNotMatch(proposal, /migrateTasksToPlans/, 'the fictitious migration CLI must be gone');
    assert.doesNotMatch(proposal, /^## 10\. Reference grounding \(verified\)/m, 'baseline grounding must not claim to be current');
  });

  it('the committed MCP artifacts match the generated registry (Slice R)', () => {
    const committedReadme = read('.SprintDesk/mcp/README.md').replace(/\r\n/g, '\n');
    assert.equal(committedReadme, buildMcpReadme(), '.SprintDesk/mcp/README.md is stale; regenerate it');
    const committedManifest = JSON.parse(read('.SprintDesk/mcp/manifest.json')) as unknown;
    assert.deepEqual(committedManifest, buildMcpManifest(), '.SprintDesk/mcp/manifest.json is stale; regenerate it');
  });

  it('no document requires a Task→Plan migration utility (Slice O)', () => {
    const docs = ['README.md', 'CHANGELOG.md', 'docs/current-features.md', 'docs/v1.0.0-proposal.md']
      .map(read)
      .join('\n');
    assert.doesNotMatch(docs, /migrateTasksToPlans/, 'no doc may reference the removed migration CLI');
    assert.match(docs, /no Task→Plan migration/i, 'the docs must state that no Task→Plan migration ships');
  });

  it('the sidebar Control Center exposes the v1.1 sections without parallel Plan storage (Slice T)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^## \[1\.1\.0\]/m, 'CHANGELOG must record the [1.1.0] release');
    assert.match(changelog, /^### v1\.0 Slice T /m, 'CHANGELOG must document v1.0 Slice T');

    const doc = read('docs/current-features.md');
    for (const section of [
      'People',
      'MCP',
      'Tools',
      'Models',
      'Requests',
      'Plans',
      'Findings',
      'Approvals',
      'Schedules',
      'Workflows',
      'Activity',
      'History'
    ]) {
      assert.match(doc, new RegExp(`\\*\\*${section}\\*\\*`), `current-features must document the ${section} section`);
    }
    assert.doesNotMatch(doc, /findings\/Plans\.yml/, 'docs must not describe parallel Plan storage');

    const pkg = JSON.parse(read('package.json')) as { contributes?: { commands?: Array<{ command: string }> } };
    const commands = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    for (const command of ['sprintdesk.runOrganizer', 'sprintdesk.openPlan', 'sprintdesk.approveApproval', 'sprintdesk.addTool']) {
      assert.ok(commands.has(command), `manifest must declare ${command}`);
    }
  });

  it('the Orchestrator team and automatic intake are documented (Slice U)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^### v1\.0 Slice U /m, 'CHANGELOG must document v1.0 Slice U');

    const doc = read('docs/current-features.md');
    assert.match(doc, /runIntakePass/, 'current-features must document automatic intake');
    assert.match(doc, /human-sync/, 'current-features must document the orchestration roles');
    assert.match(doc, /queueSettings\.enabled/, 'current-features must document the execution gate');

    const pkg = JSON.parse(read('package.json')) as { contributes?: { commands?: Array<{ command: string }> } };
    const commands = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    for (const command of ['sprintdesk.assignOrchestrationRole', 'sprintdesk.clearOrchestrationRole']) {
      assert.ok(commands.has(command), `manifest must declare ${command}`);
    }
  });

  it('the model catalog is documented and wired (Slice V)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^### v1\.0 Slice V /m, 'CHANGELOG must document v1.0 Slice V');

    const doc = read('docs/current-features.md');
    assert.match(doc, /models\.yml/, 'current-features must document the model catalog store');
    assert.match(doc, /modelId/, 'current-features must document the agent→model provenance link');

    const pkg = JSON.parse(read('package.json')) as { contributes?: { commands?: Array<{ command: string }> } };
    const commands = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    for (const command of ['sprintdesk.addModel', 'sprintdesk.assignModelToAgent', 'sprintdesk.selectAgentModel']) {
      assert.ok(commands.has(command), `manifest must declare ${command}`);
    }
  });

  it('the plan refinement pipeline is documented (Slice W)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^### v1\.0 Slice W /m, 'CHANGELOG must document v1.0 Slice W');

    const doc = read('docs/current-features.md');
    assert.match(doc, /runPlanPipeline/, 'current-features must document the refinement pipeline');
    assert.match(doc, /plan\.ready/, 'current-features must document the terminal ready event');
    assert.match(doc, /## Classification/, 'current-features must document stage-owned sections');
    assert.match(doc, /idempotent/i, 'current-features must document pipeline idempotence');
  });
});
