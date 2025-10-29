import * as fs from 'fs';
import * as path from 'path';

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
  const base = path.join(ws, '.SprintDesk');
  const candidates = [path.join(base, 'tasks'), path.join(base, '🚀_tasks')];
  const found = candidates.filter(d => fs.existsSync(d));
  return found.length ? found : [path.join(base, 'tasks')];
}

export function fileExists(filePath: string): boolean {
  try { return fs.existsSync(filePath); } catch { return false; }
}
