import * as path from 'path';
import { getWorkspaceRoot } from '../../fileService';
import { getFileSystem } from '../../../host';

export interface SecretStoreFile {
  secrets: Record<string, string>;
}

const SECRET_DIR = path.join('.SprintDesk', 'workforce');
const SECRET_FILE = 'credentials.secret.json';

function secretFilePath(): string | undefined {
  const root = getWorkspaceRoot();
  return root ? path.join(root, SECRET_DIR, SECRET_FILE) : undefined;
}

function loadSecretFile(): SecretStoreFile {
  const file = secretFilePath();
  if (!file) {
    return { secrets: {} };
  }
  const fs = getFileSystem();
  if (!fs.exists(file)) {
    return { secrets: {} };
  }
  try {
    return JSON.parse(fs.readFile(file)) as SecretStoreFile;
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