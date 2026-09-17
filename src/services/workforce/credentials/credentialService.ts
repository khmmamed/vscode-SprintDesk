import * as path from 'path';
import { getWorkspaceRoot } from '../../fileService';
import { getFileSystem } from '../../../host';

export interface SecretStoreFile {
  secrets: Record<string, string>;
}

const SECRET_DIR = path.join('.SprintDesk', 'settings');
const LEGACY_SECRET_DIR = path.join('.SprintDesk', 'workforce');
const SECRET_FILE = 'credentials.secret.json';

function secretFilePath(): string | undefined {
  const root = getWorkspaceRoot();
  return root ? path.join(root, SECRET_DIR, SECRET_FILE) : undefined;
}

function legacySecretFilePath(): string | undefined {
  const root = getWorkspaceRoot();
  return root ? path.join(root, LEGACY_SECRET_DIR, SECRET_FILE) : undefined;
}

// v1.0 Slice K — read-only continuity: secrets persisted under the former
// workforce/ directory are still resolved until the next write lands in settings/.
function loadSecretFile(): SecretStoreFile {
  const fs = getFileSystem();
  const file = secretFilePath();
  const legacy = legacySecretFilePath();
  const source = file && fs.exists(file) ? file : legacy && fs.exists(legacy) ? legacy : undefined;
  if (!source) {
    return { secrets: {} };
  }
  try {
    return JSON.parse(fs.readFile(source)) as SecretStoreFile;
  } catch {
    return { secrets: {} };
  }
}

function saveSecretFile(data: SecretStoreFile): void {
  const file = secretFilePath();
  if (!file) {
    return;
  }
  getFileSystem().mkdir(path.dirname(file), { recursive: true });
  getFileSystem().writeFile(file, JSON.stringify(data, null, 2));
}

/**
 * Resolve a credential reference to a real secret value.
 *
 * Supported reference formats:
 *   env:NAME        -> process.env.NAME
 *   secret:NAME     -> NAME stored in the gitignored credentials.secret.json
 *   (any other value) -> undefined; plaintext secrets in tracked YAML are never accepted
 */
export function resolveCredential(ref: string): string | undefined {
  if (!ref || typeof ref !== 'string') {
    return undefined;
  }
  if (ref.startsWith('env:')) {
    const name = ref.slice('env:'.length).trim();
    return name ? process.env[name] : undefined;
  }
  if (ref.startsWith('secret:')) {
    const name = ref.slice('secret:'.length).trim();
    return name ? loadSecretFile().secrets[name] : undefined;
  }
  return undefined;
}

export function hasCredential(ref?: string): boolean {
  if (!ref) {
    return false;
  }
  return resolveCredential(ref) !== undefined;
}

export function saveSecret(name: string, value: string): void {
  if (!name) {
    return;
  }
  const data = loadSecretFile();
  data.secrets = { ...data.secrets, [name]: value };
  saveSecretFile(data);
}

export function listSecretNames(): string[] {
  return Object.keys(loadSecretFile().secrets);
}