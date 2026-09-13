import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCredential, hasCredential, saveSecret, listSecretNames } from '../../src/services/workforce/credentials/credentialService';
import { makeWorkspace, TestWorkspace } from '../helpers/workspace';

describe('credential facade', () => {
  let ws: TestWorkspace;

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('resolves env: references from the process environment', () => {
    process.env['SPRINTDESK_TEST_SECRET'] = 'env-value';
    try {
      assert.strictEqual(resolveCredential('env:SPRINTDESK_TEST_SECRET'), 'env-value');
      assert.strictEqual(hasCredential('env:SPRINTDESK_TEST_SECRET'), true);
    } finally {
      delete process.env['SPRINTDESK_TEST_SECRET'];
    }
  });

  it('resolves secret: references from the gitignored secret file', () => {
    const ref = 'secret:api_key';
    assert.strictEqual(resolveCredential(ref), undefined);
    assert.strictEqual(hasCredential(ref), false);

    saveSecret('api_key', 'my-secret-value');
    assert.strictEqual(resolveCredential(ref), 'my-secret-value');
    assert.strictEqual(hasCredential(ref), true);
    assert.deepStrictEqual(listSecretNames(), ['api_key']);
  });

  it('stores secrets in .SprintDesk/workforce/credentials.secret.json', () => {
    saveSecret('token', 'abc123');
    const file = path.join(ws.root, '.SprintDesk', 'workforce', 'credentials.secret.json');
    assert.ok(fs.existsSync(file), 'secret file should exist under .SprintDesk/workforce');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('abc123'));
    assert.ok(!content.includes('.yml'), 'secrets must never be stored in YAML');
  });

  it('never resolves inline/plaintext values in tracked YAML', () => {
    assert.strictEqual(resolveCredential('sk-live-key'), undefined);
    assert.strictEqual(resolveCredential(''), undefined);
    assert.strictEqual(resolveCredential('env:'), undefined);
    assert.strictEqual(resolveCredential('secret:'), undefined);
    assert.strictEqual(hasCredential(undefined), false);
  });
});