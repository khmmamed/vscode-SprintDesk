import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeWorkspace, TestWorkspace } from '../helpers/workspace';
import { getStores } from '../../src/data/stores';
import { Approval, EventRule, ExecutionWindow, Finding, Proposal } from '../../src/data/types';

type Stores = ReturnType<typeof getStores>;

function now(): string {
  return new Date().toISOString();
}

function makeFinding(id: string): Finding {
  return {
    id,
    title: `Finding ${id}`,
    agent: 'agent_1',
    timestamp: now(),
    severity: 'medium',
    status: 'pending',
    source: { runId: 'run_1' }
  };
}

function makeApproval(id: string): Approval {
  return {
    id,
    type: 'config-change',
    status: 'pending',
    reason: 'test',
    target: id,
    pending: { op: 'apply-config', employeeId: 'emp_1', changes: {} },
    createdAt: now()
  };
}

function makeEventRule(id: string): EventRule {
  return {
    id,
    name: `Rule ${id}`,
    enabled: true,
    matcher: { eventType: 'run.finished' },
    workflowId: 'wf_1',
    runCount: 0,
    recentTriggers: [],
    createdAt: now(),
    updatedAt: now()
  };
}

function makeProposal(id: string): Proposal {
  return {
    id,
    findingId: 'fnd_1',
    runId: 'run_1',
    agent: 'agent_1',
    title: `Proposal ${id}`,
    type: 'feature',
    priority: 'medium',
    status: 'pending',
    createdAt: now()
  };
}

function makeWindow(id: string): ExecutionWindow {
  return {
    id,
    name: `Window ${id}`,
    status: 'planned',
    workflowIds: [],
    agentIds: [],
    planIds: [],
    runIds: [],
    createdAt: now(),
    updatedAt: now()
  };
}

interface RelocationCase {
  label: string;
  storeKey: keyof Stores;
  file: string;
  legacyId: string;
  legacyBody: string;
  write: (stores: Stores, id: string) => void;
}

const CASES: RelocationCase[] = [
  {
    label: 'findings',
    storeKey: 'findings',
    file: 'findings.yml',
    legacyId: 'fnd_legacy',
    legacyBody:
      "findings:\n  - id: fnd_legacy\n    title: Legacy finding\n    agent: agent_1\n    timestamp: '2024-01-01T00:00:00Z'\n    severity: medium\n    status: pending\n    source:\n      runId: run_legacy\n",
    write: (stores, id) => stores.findings.add(makeFinding(id))
  },
  {
    label: 'approvals',
    storeKey: 'approvals',
    file: 'approvals.yml',
    legacyId: 'apr_legacy',
    legacyBody:
      "approvals:\n  - id: apr_legacy\n    type: config-change\n    status: pending\n    reason: legacy\n    target: legacy\n    pending:\n      op: apply-config\n      employeeId: emp_1\n      changes: {}\n    createdAt: '2024-01-01T00:00:00Z'\n",
    write: (stores, id) => stores.approvals.add(makeApproval(id))
  },
  {
    label: 'skills',
    storeKey: 'skills',
    file: 'skills.yml',
    legacyId: 'skill_legacy',
    legacyBody: 'skills:\n  - id: skill_legacy\n    name: legacy-skill\n',
    write: (stores, id) => stores.skills.add({ id, name: id })
  },
  {
    label: 'eventRules',
    storeKey: 'eventRules',
    file: 'eventRules.yml',
    legacyId: 'rule_legacy',
    legacyBody:
      "eventRules:\n  - id: rule_legacy\n    name: Legacy rule\n    enabled: true\n    workflowId: wf_1\n    runCount: 0\n    recentTriggers: []\n    createdAt: '2024-01-01T00:00:00Z'\n    updatedAt: '2024-01-01T00:00:00Z'\n",
    write: (stores, id) => stores.eventRules.add(makeEventRule(id))
  },
  {
    label: 'classification',
    storeKey: 'proposals',
    file: 'classification.yml',
    legacyId: 'prop_legacy',
    legacyBody:
      "proposals:\n  - id: prop_legacy\n    findingId: fnd_1\n    runId: run_1\n    agent: agent_1\n    title: Legacy proposal\n    type: feature\n    priority: medium\n    status: pending\n    createdAt: '2024-01-01T00:00:00Z'\n",
    write: (stores, id) => stores.proposals.add(makeProposal(id))
  },
  {
    label: 'executionWindows',
    storeKey: 'executionWindows',
    file: 'executionWindows.yml',
    legacyId: 'win_legacy',
    legacyBody:
      "executionWindows:\n  - id: win_legacy\n    name: Legacy window\n    status: planned\n    workflowIds: []\n    agentIds: []\n    planIds: []\n    runIds: []\n    createdAt: '2024-01-01T00:00:00Z'\n    updatedAt: '2024-01-01T00:00:00Z'\n",
    write: (stores, id) => stores.executionWindows.add(makeWindow(id))
  }
];

describe('storage boundary (Slice K)', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  const sd = (): string => path.join(ws.root, '.SprintDesk');
  const dbFile = (file: string): string => path.join(sd(), 'database', file);
  const legacyFile = (file: string): string => path.join(sd(), 'workforce', file);

  function seedLegacy(file: string, body: string): void {
    fs.mkdirSync(path.join(sd(), 'workforce'), { recursive: true });
    fs.writeFileSync(legacyFile(file), body, 'utf8');
  }

  it('state stores never create a workforce/ directory', () => {
    const stores = getStores(ws.root);
    stores.skills.add({ id: 'skill_a', name: 'alpha' });
    stores.findings.add(makeFinding('fnd_a'));
    stores.approvals.add(makeApproval('apr_a'));
    assert.ok(!fs.existsSync(path.join(sd(), 'workforce')), 'workforce/ must not be created by state stores');
  });

  for (const c of CASES) {
    it(`relocates ${c.label} from workforce/ to database/ with legacy read-back`, () => {
      // Simulate a pre-v1.0 workspace: legacy state only, no database/ copy yet.
      fs.rmSync(dbFile(c.file), { force: true });
      seedLegacy(c.file, c.legacyBody);

      const stores = getStores(ws.root);
      assert.ok((stores[c.storeKey] as any).getById(c.legacyId), `${c.label} should read the legacy record`);

      c.write(stores, `${c.storeKey}_new`);
      assert.ok(fs.existsSync(dbFile(c.file)), `${c.file} should be written under database/`);
      assert.ok(fs.readFileSync(dbFile(c.file), 'utf8').includes(`${c.storeKey}_new`), `${c.file} should hold the new record`);
      assert.ok(fs.existsSync(legacyFile(c.file)), 'legacy file is read-only continuity, left in place');
    });
  }

  it('relocates policy from workforce/ to database/ with legacy read-back', () => {
    seedLegacy('policy.yml', "policy:\n  roles:\n    lead: [view-stores]\n");
    const stores = getStores(ws.root);

    assert.deepStrictEqual(stores.policy.getRolePermissions('lead'), ['view-stores']);

    stores.policy.save(stores.policy.load());
    assert.ok(fs.existsSync(dbFile('policy.yml')), 'policy.yml should be written under database/');
    assert.ok(fs.readFileSync(dbFile('policy.yml'), 'utf8').includes('view-stores'));
  });
});
