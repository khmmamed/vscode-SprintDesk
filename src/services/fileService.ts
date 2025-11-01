import * as fs from 'fs';
import * as path from 'path';
import { PROJECT } from '../utils/constant';

export function readFileSyncSafe(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return '';
  }
}

export function listMdFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  } catch (e) {
    return [];
  }
}

export function getExistingTasksDirs(ws: string): string[] {
  const base = path.join(ws, PROJECT.SPRINTDESK_DIR);
  const candidates = [path.join(base, PROJECT.TASKS_DIR)];
  const found = candidates.filter(d => fs.existsSync(d));
  return found.length ? found : [path.join(base, PROJECT.TASKS_DIR)];
}

export function fileExists(filePath: string): boolean {
  try { return fs.existsSync(filePath); } catch { return false; }
}
