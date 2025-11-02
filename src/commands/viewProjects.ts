import * as vscode from "vscode";
import * as matter from "gray-matter";
import { getWebviewContent } from "../webview/getWebviewContent";

interface FileInfo {
    name: string;
    displayName: string;
    mtime: number;
    meta?: any;
    path: string;
    lastCommit: string;
    lastUpdate: string;
}

interface Project {
    name: string;
    path: string;
    lastCommit: string;
    lastUpdate: string;
    backlogs: FileInfo[];
    epics: FileInfo[];
    sprints: FileInfo[];
    tasks: FileInfo[];
}

export async function scanSprintDeskFolders(baseUri: vscode.Uri): Promise<Project[]> {
    const projects: Project[] = [];
    const queue: [vscode.Uri, string[]][] = [[baseUri, []]];

    while (queue.length > 0) {
        const [currentUri, pathSegments] = queue.shift()!;
        try {
            const entries = await vscode.workspace.fs.readDirectory(currentUri);
            
            // Check if current directory has a .SprintDesk folder
            const sprintDeskEntry = entries.find(([name]) => name === '.SprintDesk');
            if (sprintDeskEntry) {
                // Found a .SprintDesk folder - this is a project
                const sprintDeskUri = vscode.Uri.joinPath(currentUri, '.SprintDesk');
                const projectPath = vscode.workspace.asRelativePath(currentUri);
                const projectName = currentUri.path.split('/').pop() || 'Unknown Project';
                
                const categories = {
                    backlogs: [] as FileInfo[],
                    epics: [] as FileInfo[],
                    sprints: [] as FileInfo[],
                    tasks: [] as FileInfo[]
                };

                // Read each category folder
                const sprintDeskEntries = await vscode.workspace.fs.readDirectory(sprintDeskUri);
                for (const [name, type] of sprintDeskEntries) {
                    if (type === vscode.FileType.Directory) {
                        const lowerName = name.toLowerCase();
                        const categoryKey = lowerName.replace(/s$/, '') + 's';

                        if (categoryKey in categories) {
                            const categoryUri = vscode.Uri.joinPath(sprintDeskUri, name);
                            const files = await vscode.workspace.fs.readDirectory(categoryUri);
                            
                            const fileInfos = await Promise.all(
                                files
                                .filter(([_, type]) => type === vscode.FileType.File)
                                .map(async ([fileName]) => {
                                    const fileUri = vscode.Uri.joinPath(categoryUri, fileName);
                                    const stat = await vscode.workspace.fs.stat(fileUri);
                                    let displayName = fileName;
                                    let meta: any = {};

                                    if (fileName.toLowerCase().endsWith('.md')) {
                                        try {
                                            const bytes = await vscode.workspace.fs.readFile(fileUri);
                                            const text = Buffer.from(bytes).toString('utf8');
                                            const parsed = matter.default(text);
                                            meta = parsed.data || {};
                                          
                                            if (parsed.data && parsed.data.title) {
                                                displayName = parsed.data.title;
                                            }

                                            // Derive sprint time progress from YAML metadata if available
                                            // Supported keys (case-insensitive): start, startDate, start_date and end, endDate, end_date
                                            try {
                                                const toDate = (v: any): Date | null => {
                                                    if (!v) return null;
                                                    if (v instanceof Date) return v;
                                                    const s = String(v).trim();
                                                    // Accept ISO, yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy, mm/dd/yyyy, yyyy/mm/dd
                                                    const iso = Date.parse(s);
                                                    if (!Number.isNaN(iso)) return new Date(iso);
                                                    // Try dd-mm-yyyy
                                                    const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
                                                    if (dmy) {
                                                        const d = parseInt(dmy[1], 10);
                                                        const m = parseInt(dmy[2], 10) - 1;
                                                        const y = parseInt(dmy[3].length === 2 ? ('20' + dmy[3]) : dmy[3], 10);
                                                        const dt = new Date(y, m, d);
                                                        return Number.isNaN(dt.getTime()) ? null : dt;
                                                    }
                                                    return null;
                                                };

                                                const lowerKeys: Record<string, any> = {};
                                                Object.keys(meta || {}).forEach(k => lowerKeys[k.toLowerCase()] = (meta as any)[k]);

                                                // also consider nested sprint: {..., sprint: { start, end }}
                                                const sprintObj: any = lowerKeys['sprint'];
                                                const nestedLower: Record<string, any> = {};
                                                if (sprintObj && typeof sprintObj === 'object') {
                                                    Object.keys(sprintObj).forEach(k => nestedLower[k.toLowerCase()] = sprintObj[k]);
                                                }

                                                const startRaw = lowerKeys['start'] ?? lowerKeys['startdate'] ?? lowerKeys['start_date'] ?? nestedLower['start'] ?? nestedLower['startdate'] ?? nestedLower['start_date'];
                                                const endRaw = lowerKeys['end'] ?? lowerKeys['enddate'] ?? lowerKeys['end_date'] ?? nestedLower['end'] ?? nestedLower['enddate'] ?? nestedLower['end_date'];
                                                const startDate = toDate(startRaw);
                                                const endDate = toDate(endRaw);
                                                if (startDate && endDate && endDate.getTime() >= startDate.getTime()) {
                                                    const now = new Date();
                                                    const startMs = startDate.getTime();
                                                    const endMs = endDate.getTime();
                                                    const nowMs = now.getTime();
                                                    const total = endMs - startMs;
                                                    const elapsed = Math.min(Math.max(nowMs - startMs, 0), total);
                                                    const timePercent = Math.round((elapsed / total) * 100);
                                                    meta.sprintTime = {
                                                        start: startDate.toISOString(),
                                                        end: endDate.toISOString(),
                                                        progress: timePercent,
                                                        finished: nowMs >= endMs,
                                                        upcoming: nowMs < startMs
                                                    };
                                                }
                                            } catch {
                                                // ignore date parsing issues
                                            }

                                            // If this is a sprint file, try to parse a markdown table in the body
                                            // and compute basic progress metrics.
                                            try {
                                                const body = parsed.content || text;
                                                const table = parseMarkdownTable(body);
                                                if (table && table.rows && table.rows.length) {
                                                    meta.sprintTable = {
                                                        headers: table.headers,
                                                        rows: table.rows
                                                    };

                                                    // Compute percent complete by looking for a column named 'status' or 'done'
                                                    const statusColIndex = table.headers
                                                        .map(h => h.toLowerCase())
                                                        .findIndex(h => ['status', 'state', 'done'].includes(h));

                                                    if (statusColIndex !== -1) {
                                                        const total = table.rows.length;
                                                        const doneCount = table.rows.filter(r => {
                                                            const v = (r[statusColIndex] || '').toString().toLowerCase();
                                                            return v === 'done' || v === 'complete' || v === 'closed' || v === 'true' || v === 'yes';
                                                        }).length;
                                                        const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                                                        meta.sprintProgress = percent;
                                                    }
                                                }
                                            } catch (e) {
                                                // ignore table parse errors
                                            }
                                        } catch (e) {
                                            console.error('Error parsing markdown:', e);
                                        }
                                    }

                                    return {
                                        name: fileName,
                                        displayName,
                                        path: `${projectPath}/.SprintDesk/${name}/${fileName}`,
                                        mtime: stat.mtime,
                                        meta,
                                        lastCommit: '',
                                        lastUpdate: new Date(stat.mtime).toLocaleString()
                                    };
                                })
                            );

                            categories[categoryKey as keyof typeof categories] = fileInfos;
                        }
                    }
                }

                projects.push({
                    name: projectName,
                    path: projectPath,
                    lastCommit: '',
                    lastUpdate: new Date().toLocaleString(),
                    ...categories
                });
            }

            // Add subdirectories to queue (skip node_modules and .git)
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && 
                    name !== 'node_modules' && 
                    name !== '.git' && 
                    name !== '.SprintDesk') {
                    queue.push([
                        vscode.Uri.joinPath(currentUri, name),
                        [...pathSegments, name]
                    ]);
                }
            }
        } catch (error) {
            console.error(`Error scanning directory ${currentUri.path}:`, error);
        }
    }

    return projects;
}

// Very small markdown table parser: returns headers array and rows as array of arrays
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
    if (!text) return null;
    // find table start: a header line with '|' followed by a separator line with dashes
    const lines = text.split(/\r?\n/).map(l => l.trim());
    for (let i = 0; i < lines.length - 1; i++) {
        const headerLine = lines[i];
        const sepLine = lines[i + 1];
        if (headerLine.startsWith('|') && /\|?\s*-+\s*\|/.test(sepLine)) {
            const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
            const rows: string[][] = [];
            for (let j = i + 2; j < lines.length; j++) {
                const line = lines[j];
                if (!line || !line.startsWith('|')) break;
                const cols = line.split('|').map(c => c.trim()).filter(() => true);
                // include possible empty first/last due to leading/trailing |
                // normalize to headers length
                const normalized: string[] = [];
                let colIndex = 0;
                for (let k = 0; k < cols.length; k++) {
                    const val = cols[k];
                    // allow empty values
                    if (k === 0 && val === '') continue; // leading empty
                    normalized.push(val);
                    colIndex++;
                    if (colIndex >= headers.length) break;
                }
                rows.push(normalized);
            }
            return { headers, rows };
        }
    }
    return null;
}

export function registerViewProjectsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("sprintdesk.viewProjects", async () => {
        const panel = vscode.window.createWebviewPanel(
            "sprintdesk-projects",
            "SprintDesk: Projects",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'dist'),
                    vscode.Uri.joinPath(context.extensionUri, 'assets'),
                ]
            }
        );

    // Set up webview content (pass view name so the webview app can render the correct view)
    panel.webview.html = getWebviewContent(context, panel.webview, 'projects');

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                const { command, payload } = msg;

                if (command === 'REQUEST_PROJECTS') {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        panel.webview.postMessage({ 
                            command: 'SET_PROJECTS', 
                            payload: { projects: [] }
                        });
                        return;
                    }

                    // Scan for all projects
                    const projects = await scanSprintDeskFolders(workspaceFolders[0].uri);
                    
                    // Send projects to webview
                    panel.webview.postMessage({ 
                        command: 'SET_PROJECTS', 
                        payload: { projects }
                    });
                } else if (command === 'REQUEST_OPEN_FILE') {
                    const { path } = payload || {};
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    
                    if (!path || !workspaceFolders) {
                        panel.webview.postMessage({ 
                            command: 'OPEN_FILE_RESULT', 
                            payload: { 
                                path, 
                                success: false, 
                                error: 'Invalid path or no workspace' 
                            }
                        });
                        return;
                    }

                    try {
                        const fullPath = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            ...path.split('/').filter(Boolean)
                        );
                        const doc = await vscode.workspace.openTextDocument(fullPath);
                        await vscode.window.showTextDocument(doc, { preview: true });
                        
                        panel.webview.postMessage({ 
                            command: 'OPEN_FILE_RESULT', 
                            payload: { 
                                path, 
                                success: true 
                            }
                        });
                    } catch (e) {
                        panel.webview.postMessage({ 
                            command: 'OPEN_FILE_RESULT', 
                            payload: { 
                                path, 
                                success: false, 
                                error: String(e)
                            }
                        });
                    }
                } else if (command === 'SAVE_SPRINT_TABLE') {
                    const { path, content } = payload || {};
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!path || !workspaceFolders) {
                        panel.webview.postMessage({ command: 'SAVE_SPRINT_TABLE_RESULT', payload: { path, success: false, error: 'Invalid path or no workspace' } });
                        return;
                    }

                    try {
                        const fullPath = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            ...path.split('/').filter(Boolean)
                        );
                        await vscode.workspace.fs.writeFile(fullPath, Buffer.from(content, 'utf8'));

                        // After saving, re-scan projects and update webview so UI reflects changes
                        const projects = await scanSprintDeskFolders(workspaceFolders[0].uri);
                        panel.webview.postMessage({ command: 'SET_PROJECTS', payload: { projects } });

                        panel.webview.postMessage({ command: 'SAVE_SPRINT_TABLE_RESULT', payload: { path, success: true } });
                    } catch (e) {
                        panel.webview.postMessage({ command: 'SAVE_SPRINT_TABLE_RESULT', payload: { path, success: false, error: String(e) } });
                    }
                }
            } catch (e) {
                console.error('Error handling message:', e);
                panel.webview.postMessage({ 
                    command: 'ERROR', 
                    payload: { error: String(e) }
                });
            }
        });
    });

    context.subscriptions.push(disposable);
}