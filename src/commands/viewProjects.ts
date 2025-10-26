import * as vscode from "vscode";
import { getWebviewContent } from "../webview/getWebviewContent";

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

    // Collect project data from the workspace
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projectName: 'No workspace', backlogs: [], epics: [], sprints: [], tasks: [] }});
        return;
      }
      const ws = folders[0];
      const projectName = ws.name;

      const readDirSafe = async (rel: string, opts?: { parseTaskTitle?: boolean }) => {
        try {
          const uri = vscode.Uri.joinPath(ws.uri, rel);
          const entries = await vscode.workspace.fs.readDirectory(uri);
          const files = entries.filter(([_, type]) => type === vscode.FileType.File);
          const stats = await Promise.all(files.map(async ([fname]) => {
            const furi = vscode.Uri.joinPath(ws.uri, rel, fname);
            const stat = await vscode.workspace.fs.stat(furi);
            let displayName = fname;
            if (opts?.parseTaskTitle && /\.md$/i.test(fname)) {
              try {
                const bytes = await vscode.workspace.fs.readFile(furi);
                const text = Buffer.from(bytes).toString('utf8');
                const m = text.match(/^#\s*Task:\s*(.+)$/mi);
                if (m && m[1]) {
                  displayName = m[1].trim();
                }
              } catch {}
            }
            return { name: fname, displayName, mtime: stat.mtime };
          }));
          stats.sort((a, b) => b.mtime - a.mtime);
          return stats.map(s => ({ name: s.displayName, lastCommit: '', lastUpdate: new Date(s.mtime).toLocaleString() }));
        } catch {
          return [] as { name: string; lastCommit: string; lastUpdate: string }[];
        }
      };

      const [backlogs, epics, sprints, tasks] = await Promise.all([
        readDirSafe('.SprintDesk/Backlogs'),
        readDirSafe('.SprintDesk/Epics'),
        readDirSafe('.SprintDesk/Sprints'),
        readDirSafe('.SprintDesk/tasks', { parseTaskTitle: true }),
      ]);

      panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projectName, backlogs, epics, sprints, tasks }});
    } catch (e) {
      panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projectName: 'Error', backlogs: [], epics: [], sprints: [], tasks: [] }});
    }
  });

  context.subscriptions.push(disposable);
};
