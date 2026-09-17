import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

  it('CHANGELOG records the v1.0 Plan-native replatform (slices A-K)', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /^## \[1\.0\.0\]/m, 'CHANGELOG must contain a [1.0.0] release section');
    assert.doesNotMatch(changelog, /^## \[Unreleased\]/m, 'release content must not remain under [Unreleased]');
    for (const slice of 'ABCDEFGHIJK'.split('')) {
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

  it('the v1.0.0 proposal is marked implemented and defers the known debt', () => {
    const proposal = read('docs/v1.0.0-proposal.md');
    assert.match(proposal, /Status: implemented \(v1\.0\.0\)/, 'proposal must be marked implemented');
    assert.match(proposal, /migrateTasksToPlans/, 'proposal must record the deferred migration CLI');
    assert.doesNotMatch(proposal, /^## 10\. Reference grounding \(verified\)/m, 'baseline grounding must not claim to be current');
  });
});
