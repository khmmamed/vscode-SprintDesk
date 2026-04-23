import * as vscode from 'vscode';

const ACTIVE_REPO_KEY = 'sprintdesk.activeRepo';

export class RepositoryStateService {
  private _activeRepo: string | undefined;
  private _onDidChangeActiveRepo = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeActiveRepo = this._onDidChangeActiveRepo.event;

  constructor(private readonly globalState: vscode.Memento) {
    this._activeRepo = globalState.get<string | undefined>(ACTIVE_REPO_KEY);
  }

  getActiveRepo(): string | undefined {
    return this._activeRepo;
  }

  setActiveRepo(repoPath: string | undefined): void {
    const previous = this._activeRepo;
    this._activeRepo = repoPath;

    if (repoPath) {
      this.globalState.update(ACTIVE_REPO_KEY, repoPath);
    } else {
      this.globalState.update(ACTIVE_REPO_KEY, undefined);
    }

    if (previous !== repoPath) {
      this._onDidChangeActiveRepo.fire(repoPath);
    }
  }

  isActiveRepo(repoPath: string): boolean {
    return this._activeRepo === repoPath;
  }
}