import * as vscode from 'vscode';

type Deps = {
  repositoriesTreeView?: any;
  createTask?: (repoPath?: string) => Promise<void>;
  tasksProvider?: any;
  sprintsProvider?: any;
};

export function registerAddTaskCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addTask', async () => {
    let repoPath: string | undefined;
    try {
      const sel = (deps.repositoriesTreeView as any)?.selection?.[0] as any;
      repoPath = sel?.fullPath ?? sel?.resourceUri?.fsPath;
    } catch (e) {
      repoPath = undefined;
    }

    if (!repoPath) {
      const wsFolders = vscode.workspace.workspaceFolders;
      if (wsFolders && wsFolders.length > 0) {
        repoPath = wsFolders[0].uri.fsPath;
      }
    }

    await deps.createTask?.(repoPath);
    deps.tasksProvider?.refresh?.();
    deps.sprintsProvider?.refresh?.();
  }));
}
