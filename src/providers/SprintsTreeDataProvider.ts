import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT, UI } from '../utils/constant';
import matter from 'gray-matter';

export class SprintsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: SprintsTreeItem[] = [],
    public readonly filePath?: string, // for sprint items, reference to the sprint file on disk
    public readonly taskSlug?: string, // for task child items, original slug (e.g., add-status-to-product)
    public readonly taskFilePath?: string, // for task child items, resolved file path to the task file
    public readonly sprintFilePath?: string // for task child items, sprint file path containing the task
  ) {
    super(label, collapsibleState);

    if (filePath && !taskFilePath) {
      // This is a sprint item
      this.contextValue = 'sprint';
      this.description = '📅 Drop tasks here';
      this.resourceUri = vscode.Uri.file(filePath); // For drop highlighting
      this.iconPath = new vscode.ThemeIcon('calendar');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
        .appendMarkdown(`📅 Sprint File: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this sprint*');
    } else if (taskFilePath) {
      // This is a task item in a sprint
      this.contextValue = 'sprintTask';
      this.iconPath = new vscode.ThemeIcon('tasklist');
      if (fs.existsSync(taskFilePath)) {
        this.command = {
          command: 'vscode.open',
          title: 'Open Task',
          arguments: [vscode.Uri.file(taskFilePath)]
        };
      }
    }
  }
}

// Helper: remove git conflict blocks like <<<<<<< ... ======= ... >>>>>>>
function stripMergeMarkers(content: string): string {
  return content.replace(/<<<<<<<[\s\S]*?>>>>>>>\s*.*\n?/g, '')
    .replace(/={7,}[\s\S]*?={7,}\n?/g, '');
}

// Helper: extract YAML frontmatter block (between first pair of ---)
function extractFrontmatter(content: string): string | null {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/m);
  return m ? m[1] : null;
}



export class SprintsTreeDataProvider implements vscode.TreeDataProvider<SprintsTreeItem>, vscode.TreeDragAndDropController<SprintsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SprintsTreeItem | undefined | void> = new vscode.EventEmitter<SprintsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SprintsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-epics'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-sprints'];

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SprintsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SprintsTreeItem): Promise<SprintsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    if (!element) {
      // Root level: list all sprint files under .SprintDesk/Sprints
      return this.getSprints(workspaceRoot);
    }

    // Child level: list tasks found under "# Tasks" in the sprint file
    if (element.filePath) {
      return this.getTasksFromSprintFile(element.filePath);
    }

    return [];
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  private async getSprints(workspaceRoot: string): Promise<SprintsTreeItem[]> {
    const sprintsDir = path.join(workspaceRoot, PROJECT.SPRINTDESK_DIR, PROJECT.SPRINTS_DIR);
    if (!fs.existsSync(sprintsDir)) return [];

    const entries = fs.readdirSync(sprintsDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);

    const items = await Promise.all(files.map(async (name) => {
      const filePath = path.join(sprintsDir, name);
      // Prefer parsing from filename based on the required pattern
      const range = this.parseDateRangeFromFilename(name) || this.parseSprintDateRangeFromFile(filePath);
      let label: string;
      if (range) {
        const [start, end] = range;
        label = `📅 ${this.formatDMY(start)} ➜ ${this.formatDMY(end)}`;
      } else {
        // Fallback to humanized filename if no dates found
        label = this.humanizeSprintName(name);
      }
      const item = new SprintsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath);
      item.contextValue = 'sprint';
      return item;
    }));

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    return items;
  }

  private humanizeSprintName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base.replace(/^\[(?:Sprint|S)\]_?/i, '').replace(/[_-]+/g, ' ').trim();
    return cleaned || base;
  }

  private formatDMY(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

async handleDrop(target: SprintsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
  try {
    if (!target?.filePath || target.contextValue !== 'sprint') {
      console.log("Drop target invalid or not a sprint");
      return;
    }

    console.log("Starting handleDrop for sprint:", target.filePath);

    const taskSources = [
      { mimeType: 'application/vnd.code.tree.sprintdesk-tasks', source: 'Tasks' },
      { mimeType: 'application/vnd.code.tree.sprintdesk-backlogs', source: 'Backlogs' },
      { mimeType: 'application/vnd.code.tree.sprintdesk-epics', source: 'Epics' },
      { mimeType: 'application/vnd.code.tree.sprintdesk-sprints', source: 'Sprints' }
    ];

    let handleData: any = null;
    let sourceType = '';
    for (const source of taskSources) {
      const item = dataTransfer.get(source.mimeType);

      if (item) {
        handleData = JSON.parse(item.value as string);
        sourceType = source.source;
        break;
      }
    }
    if (!handleData) {
      console.log("No task data found in dataTransfer");
      return;
    }

    console.log("Received drop data from:", sourceType, handleData);

    let taskFilePath: string;
    let taskMetadata: any = {};

    // Check if we have the new combined format
    if (handleData.taskData) {
      console.log("Found full task data in transfer");
      taskFilePath = handleData.taskData.path;
      taskMetadata = {
        name: handleData.taskData.name,
        status: handleData.taskData.status,
        priority: handleData.taskData.priority,
        type: handleData.taskData.type,
        epic: handleData.taskData.epic
      };
    }

    // Handle new TaskData format
    if (handleData._id && handleData.path) {
      console.log("Using new TaskData format");
      taskFilePath = handleData.path;
      taskMetadata = {
        name: handleData.name,
        status: handleData.status,
        priority: handleData.priority,
        type: handleData.type
      };
    }
    // Handle legacy filePath format
    else if (handleData.filePath) {
      taskFilePath = handleData.filePath;
      console.log("Using provided filePath:", taskFilePath);
    }
    // Handle legacy taskPath format
    else if (handleData.taskPath) {
      taskFilePath = handleData.taskPath;
      console.log("Using provided taskPath:", taskFilePath);
    }
    // Handle legacy itemHandles format
    else if (handleData.itemHandles && handleData.itemHandles.length > 0) {
      const handleRaw = handleData.itemHandles[0];
      console.log("Raw item handle:", handleRaw);

      // Extract task ID if present in the original form
      const idMatch = handleRaw.match(/tsk_([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        const taskId = idMatch[1];
        const ws = this.getWorkspaceRoot();
        if (!ws) throw new Error("No workspace root found");
        
        taskFilePath = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR, `[Task]_tsk_${taskId}.md`);
      } else {
        // Fallback to legacy path construction
        const m = handleRaw.match(/\d+\/\d+:(.+)$/);
        if (!m?.[1]) throw new Error('Invalid task handle format');

        const taskName = m[1]
          .replace(/^[^\w[]+\s*/u, '');

        const ws = this.getWorkspaceRoot();
        if (!ws) throw new Error("No workspace root found");


        taskFilePath = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR, `[Task]_${taskName}.md`);
      }
      console.log("Constructed task file path:", taskFilePath);
    } else {
      throw new Error("No task path found in drop data");
    }

    if (!fs.existsSync(taskFilePath)) throw new Error(`Task file not found: ${taskFilePath}`);

    console.log("Task file exists:", taskFilePath);

    const sprintContent = fs.readFileSync(target.filePath, 'utf8');
    const sprintMatter = matter(sprintContent);
    if (!Array.isArray(sprintMatter.data.tasks)) sprintMatter.data.tasks = [];

    const taskContent = fs.readFileSync(taskFilePath, 'utf8');
    const taskMatter = matter(taskContent);

    const taskName = taskMatter.data.title || taskMatter.data.name ||
      path.basename(taskFilePath, '.md').replace(/^\[Task\]_/, '').replace(/-/g, ' ');

    console.log("Task name resolved:", taskName);

    // Merge metadata from the drag source with file data
    const taskData = {
      name: taskMetadata.name || taskName,
      status: taskMetadata.status || taskMatter.data.status || 'not-started',
      file: path.relative(path.dirname(target.filePath), taskFilePath).replace(/\\/g, '/'),
      description: taskMatter.data.description || '',
      priority: taskMetadata.priority || taskMatter.data.priority || 'medium',
      type: taskMetadata.type || taskMatter.data.type || 'feature'
    };

    const idx = sprintMatter.data.tasks.findIndex((t: any) => t.file === taskData.file);
    if (idx >= 0) sprintMatter.data.tasks[idx] = taskData;
    else sprintMatter.data.tasks.push(taskData);

    const marker = UI.SECTIONS.TASKS_MARKER;
    if (!sprintMatter.content.includes(marker)) sprintMatter.content += `\n\n${marker}\n`;

    const link = `- ${UI.EMOJI.STATUS.NOT_STARTED} [${taskData.name}](${taskData.file})`;
    const pos = sprintMatter.content.indexOf(marker);
    if (pos !== -1) {
      sprintMatter.content = sprintMatter.content.slice(0, pos + marker.length) + "\n" + link + sprintMatter.content.slice(pos + marker.length);
    }

    fs.writeFileSync(target.filePath, matter.stringify(sprintMatter.content, sprintMatter.data));
    this.refresh();
    void vscode.window.showInformationMessage(`Task added to sprint: ${taskData.name}`);

  } catch (err: any) {
    console.error("Drop error:", err);
    void vscode.window.showErrorMessage(`Failed to add task to sprint: ${err.message || err}`);
  }
}






  handleDrag(source: SprintsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];
        if (!taskItem.taskFilePath) {
          return; // Only tasks can be dragged, not sprint items
        }

        // Create a consistent task data object
        const taskData = {
          id: path.basename(taskItem.taskFilePath, '.md'),
          label: taskItem.label,
          filePath: taskItem.taskFilePath,
          type: 'task',
          sourceContainer: {
            type: 'sprint',
            path: taskItem.sprintFilePath
          }
        };

        dataTransfer.set('application/vnd.code.tree.sprintdesk-sprints',
          new vscode.DataTransferItem(JSON.stringify(taskData))
        );

        void vscode.window.showInformationMessage(`Dragging task: ${taskItem.label}`);
      }
    } catch (error) {
      console.error('Drag error:', error);
      void vscode.window.showErrorMessage('Failed to start drag: ' + (error as Error).message);
    }
  }

  private parseSprintDateRangeFromFile(filePath: string): [Date, Date] | null {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      // Remove any git merge conflict markers which may break parsing
      content = stripMergeMarkers(content);
      // If there's a YAML frontmatter with start_date/end_date, prefer that
      const fm = extractFrontmatter(content);
      if (fm) {
        const sd = fm.match(/start_date:\s*(\d{4}-\d{2}-\d{2})/i) || fm.match(/start:\s*(\d{4}-\d{2}-\d{2})/i);
        const ed = fm.match(/end_date:\s*(\d{4}-\d{2}-\d{2})/i) || fm.match(/end:\s*(\d{4}-\d{2}-\d{2})/i);
        if (sd && ed) {
          const a = new Date(sd[1]);
          const b = new Date(ed[1]);
          return a <= b ? [a, b] : [b, a];
        }
      }
      const contentToParse = content;
      const isoRegex = /(\d{4})-(\d{2})-(\d{2})/g; // yyyy-mm-dd
      const dmyRegex = /(\d{2})-(\d{2})-(\d{4})/g; // dd-mm-yyyy
      const dates: Date[] = [];
      let m: RegExpExecArray | null;
      while ((m = isoRegex.exec(content)) && dates.length < 2) {
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        dates.push(d);
      }
      if (dates.length < 2) {
        while ((m = dmyRegex.exec(contentToParse)) && dates.length < 2) {
          const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
          dates.push(d);
        }
      }
      if (dates.length >= 2) {
        const [a, b] = dates;
        return a <= b ? [a, b] as [Date, Date] : [b, a] as [Date, Date];
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseDateRangeFromFilename(name: string): [Date, Date] | null {
    // Expected filename pattern (without extension): [Sprint]_dd-mm_dd-mm_yyyy or [Sprint]_dd-mm_dd-mm_yy
    const base = name.replace(/\.[^.]+$/, '');
    const re = /^\[(?:Sprint|S)\]_(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{2,4})$/i;
    const m = base.match(re);
    if (!m) return null;
    const d1 = parseInt(m[1], 10);
    const m1 = parseInt(m[2], 10) - 1;
    const d2 = parseInt(m[3], 10);
    const m2 = parseInt(m[4], 10) - 1;
    let y = parseInt(m[5], 10);
    if (m[5].length === 2) {
      y = 2000 + y; // assume 20xx for two-digit years
    }
    const start = new Date(y, m1, d1);
    const end = new Date(y, m2, d2);
    return start <= end ? [start, end] : [end, start];
  }

  private getStatusEmojiFromText(text: string): string {
    const m = text.match(/\{[^}]*status\s*:\s*([a-z]+)[^}]*\}/i);
    const status = m ? m[1].toLowerCase() : '';
    switch (status) {
      case 'waiting':
        return '🟡';
      case 'started':
        return '🔵';
      case 'finished':
        return '🟢';
      case 'reopened':
        return '🟠';
      case 'closed':
        return '⚫';
      default:
        return '';
    }
  }

  private async getTasksFromSprintFile(filePath: string): Promise<SprintsTreeItem[]> {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      content = stripMergeMarkers(content);

      // First try YAML frontmatter 'tasks:' entries which may contain file: fields
      const fm = extractFrontmatter(content);
      const items: SprintsTreeItem[] = [];
      const seen = new Set<string>();

      if (fm && /\btasks\s*:/i.test(fm)) {
        // grab file: ../path/to/file.md occurrences inside the frontmatter
        const fileRegex = /file:\s*([^\n\r]+)/gi;
        let m: RegExpExecArray | null;
        while ((m = fileRegex.exec(fm)) !== null) {
          const rel = m[1].trim().replace(/['"]+/g, '');
          const abs = path.resolve(path.dirname(filePath), rel);
          const prettyLabel = path.basename(rel).replace(/\.[^.]+$/, '').replace(/^[^_]*_?/, '').replace(/[_-]+/g, ' ').trim();
          const displayLabel = prettyLabel;
          const treeItem = new SprintsTreeItem(displayLabel, vscode.TreeItemCollapsibleState.None, [], undefined, prettyLabel, abs, filePath);
          treeItem.contextValue = 'sprintTask';
          if (fs.existsSync(abs)) {
            Object.assign(treeItem, {
              command: {
                command: 'vscode.open',
                title: 'Open Task',
                arguments: [vscode.Uri.file(abs)]
              }
            });
            const key = `${prettyLabel}|${abs}`;
            if (!seen.has(key)) {
              seen.add(key);
              items.push(treeItem);
            }
          } else {
            // still include item even if file missing (avoid data loss)
            const key = prettyLabel;
            if (!seen.has(key)) {
              seen.add(key);
              items.push(treeItem);
            }
          }
        }
        if (items.length) return items;
      }

      // Fallback to Markdown '## Tasks' parsing
      const sectionMatch = content.match(/(^|\r?\n)#{1,6}\s*Tasks\b[^\n]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s+\S|\s*$)/i);
      if (!sectionMatch) return [];
      const section = sectionMatch[2] ?? '';

      const rawItems: string[] = [];
      const ulRegex = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      let mm: RegExpExecArray | null;
      while ((mm = ulRegex.exec(section)) !== null) {
        rawItems.push(mm[1].trim());
      }
      const olRegex = /^\s*\d+[\.)]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/gm;
      while ((mm = olRegex.exec(section)) !== null) {
        rawItems.push(mm[1].trim());
      }

      for (const itemText of rawItems) {
        const linkMatch = itemText.match(/\[([^\]]+)\]\(([^)]+)\)/);
        let labelSlug = linkMatch ? linkMatch[1] : itemText.replace(/^📌\s*/, '').trim();
        const prettyLabel = labelSlug.replace(/[_-]+/g, ' ').trim();
        const emoji = this.getStatusEmojiFromText(itemText);
        const displayLabel = (emoji ? `${emoji} ` : '') + prettyLabel;
        let key = prettyLabel;
        const rel = linkMatch ? linkMatch[2] : undefined;
        const abs = rel ? path.resolve(path.dirname(filePath), rel) : undefined;
        const treeItem = new SprintsTreeItem(displayLabel, vscode.TreeItemCollapsibleState.None, [], undefined, labelSlug, abs, filePath);
        treeItem.contextValue = 'sprintTask';
        if (abs) {
          Object.assign(treeItem, {
            command: {
              command: 'vscode.open',
              title: 'Open Task',
              arguments: [vscode.Uri.file(abs)]
            }
          });
          key = `${prettyLabel}|${abs}`;
        }
        if (!seen.has(key)) {
          seen.add(key);
          items.push(treeItem);
        }
      }

      return items;
    } catch (e) {
      return [];
    }
  }
}
