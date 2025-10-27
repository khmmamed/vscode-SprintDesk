import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";
import matter from "gray-matter";

export const registerViewProjectsCommand = (context: vscode.ExtensionContext) => {
  const disposable = vscode.commands.registerCommand("sprintdesk.viewProjects", async () => {
    const panel = vscode.window.createWebviewPanel(
      "sprintdesk-projects",
      "SprintDesk: Projects",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // Append ?view=projects so the webview App can decide what to render
    const html = getWebviewContent(context, panel.webview);
    const projectsHtml = html.replace(
      /(<body[^>]*>)/i,
      `$1<script>history.replaceState(null, '', window.location.pathname + '?view=projects');</script>`
    );
    panel.webview.html = projectsHtml;

  // Allow the webview to request the projects payload if it didn't receive
  // the initial postMessage (handshake). We'll buffer requests until the
  // payload is ready.
  let projectsPayload: any = null;
  const pendingRequests: any[] = [];
  let ws: vscode.WorkspaceFolder | undefined;
    panel.webview.onDidReceiveMessage((msg) => {
      try {
        const { command, payload } = msg || {};
        if (command === 'REQUEST_PROJECTS') {
          if (projectsPayload) {
            panel.webview.postMessage({ command: 'SET_PROJECTS', payload: projectsPayload });
          } else {
            pendingRequests.push(true);
          }
        } else if (command === 'REQUEST_OPEN_FILE') {
          // payload should be { path: '.SprintDesk/tasks/filename.md' }
          const relPath = payload?.path;
          if (relPath && ws) {
            (async () => {
              try {
                const parts = relPath.split('/').filter(Boolean);
                const furi = vscode.Uri.joinPath(ws!.uri, ...parts);
                const doc = await vscode.workspace.openTextDocument(furi);
                await vscode.window.showTextDocument(doc, { preview: true });
                panel.webview.postMessage({ command: 'OPEN_FILE_RESULT', payload: { path: relPath, success: true } });
              } catch (e) {
                panel.webview.postMessage({ command: 'OPEN_FILE_RESULT', payload: { path: relPath, success: false, error: String(e) } });
              }
            })();
          } else {
            panel.webview.postMessage({ command: 'OPEN_FILE_RESULT', payload: { path: relPath, success: false, error: 'Invalid path' } });
          }
        }
      } catch (e) {
        // ignore
      }
    });

    // Collect project data from the workspace
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projectName: 'No workspace', backlogs: [], epics: [], sprints: [], tasks: [] }});
        return;
      }
      ws = folders[0];
      const projectName = ws.name;

      const readDirSafe = async (rel: string, opts?: { parseTaskTitle?: boolean }) => {
        try {
          const uri = vscode.Uri.joinPath(ws!.uri, rel);
          const entries = await vscode.workspace.fs.readDirectory(uri);
          const files = entries.filter(([_, type]) => type === vscode.FileType.File);
          const stats = await Promise.all(files.map(async ([fname]) => {
            const furi = vscode.Uri.joinPath(ws!.uri, rel, fname);
            const stat = await vscode.workspace.fs.stat(furi);

            let displayName = fname;
            let meta: Record<string, any> | undefined;

            if (opts?.parseTaskTitle && /\.md$/i.test(fname)) {
              try {
                const bytes = await vscode.workspace.fs.readFile(furi);
                const text = Buffer.from(bytes).toString('utf8');

                // Parse front matter using gray-matter
                const parsed = matter(text);
                meta = parsed.data as Record<string, any>;

                // Determine displayName with fallbacks: front matter title -> first heading -> filename
                const fmTitle = typeof meta?.title === 'string' ? meta.title.trim() : undefined;
                if (fmTitle) {
                  displayName = fmTitle;
                } else {
                  const m = parsed.content.match(/^#\s*(.+)$/m) || text.match(/^#\s*(?:Task:)?\s*(.+)$/mi);
                  if (m && m[1]) {
                    displayName = m[1].trim();
                  }
                }
              } catch {
                // ignore parsing errors; fallback will be filename
              }
            }

            return { name: fname, displayName, mtime: stat.mtime, meta };
          }));

          // Sort by mtime desc
          stats.sort((a, b) => b.mtime - a.mtime);

          // Map to UI shape. For tasks, include known metadata when available.
          return stats.map(s => {
            const base = { lastCommit: '', lastUpdate: new Date(s.mtime).toLocaleString() };
            const relPath = `${rel}/${s.name}`;
            if (opts?.parseTaskTitle) {
              const m = s.meta || {};
              return {
                name: s.displayName,
                path: relPath,
                ...base,
                status: m.status ?? '',
                assignee: m.assignee ?? '',
                priority: m.priority ?? '',
                dueDate: m.dueDate ?? m.due ?? '',
                id: m.id ?? '',
              } as any;
            }
            return { name: s.displayName, path: relPath, ...base };
          });
        } catch {
          return [] as { name: string; lastCommit: string; lastUpdate: string }[];
        }
      };

      // Read tasks from both lowercase and capitalized directories and merge
      const [backlogs, epics, sprints, tasksLower, tasksUpper] = await Promise.all([
        readDirSafe('.SprintDesk/Backlogs'),
        readDirSafe('.SprintDesk/Epics'),
        readDirSafe('.SprintDesk/Sprints'),
        readDirSafe('.SprintDesk/tasks', { parseTaskTitle: true }),
        readDirSafe('.SprintDesk/Tasks', { parseTaskTitle: true }),
      ]);
      // Combine and de-duplicate by name, preserving order (mtime sort already applied per list)
      const seen = new Set<string>();
      const tasks = [...tasksLower, ...tasksUpper].filter(t => {
        const key = t.name?.toLowerCase?.() || t.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Wrap task file entries as children of a single "Tasks" parent row in projects table
      const payload = { projectName, backlogs, epics, sprints, tasks };
      projectsPayload = payload;
      panel.webview.postMessage({ command: 'SET_PROJECTS', payload });
      // If the webview requested the payload before we were ready, respond now
      if (pendingRequests.length) {
        panel.webview.postMessage({ command: 'SET_PROJECTS', payload });
        pendingRequests.length = 0;
      }
    } catch (e) {
      panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projectName: 'Error', backlogs: [], epics: [], sprints: [], tasks: [] }});
    }
  });

  context.subscriptions.push(disposable);
};
