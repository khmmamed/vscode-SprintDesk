import { getHost, getFileSystem } from '../host';

export function readFileSyncSafe(filePath: string): string {
  try {
    const fileSystem = getFileSystem();
    if (!fileSystem.exists(filePath)) return '';
    return fileSystem.readFile(filePath);
  } catch (e) {
    return '';
  }
}

export function getWorkspaceRoot(uri?: { fsPath: string }): string {
  const host = getHost();

  // If a file or folder path is provided (like from a sidebar click)
  if (uri) {
    const folder = host.getWorkspaceFolderForUri?.(uri.fsPath);
    if (folder) {
      return folder;
    }
  }

  // If an override was set programmatically, prefer that
  if ((getWorkspaceRoot as any)._overrideRoot) {
    return (getWorkspaceRoot as any)._overrideRoot as string;
  }

  // Fallback to host workspace root
  return host.getWorkspaceRoot() || '';
}

// Allow other parts of the extension to override the detected workspace root
export function setWorkspaceRootOverride(root?: string) {
  (getWorkspaceRoot as any)._overrideRoot = root;
}