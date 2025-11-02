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

// Helper to resolve task path from drop data
private resolveTaskPath(handleData: any): string {
  let taskFilePath: string | undefined;

  // Prefer explicit path-like fields first
  if (handleData.path) taskFilePath = handleData.path;
  else if (handleData.filePath) taskFilePath = handleData.filePath;
  else if (handleData.taskPath) taskFilePath = handleData.taskPath;

  // If legacy itemHandles exists, extract basename using split(' ')[1]
  if (!taskFilePath && handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
    const raw = String(handleData.itemHandles[0] || '');
    const parts = raw.split(' ');
    const maybeBasename = parts[1] || parts.pop() || raw;
    let base = path.basename(maybeBasename).trim();
    if (!base.toLowerCase().endsWith('.md')) base = `${base}.md`;

    const ws = this.getWorkspaceRoot();
    if (!ws) throw new Error('No workspace root found');
    taskFilePath = path.join(ws, PROJECT.SPRINTDESK_DIR, PROJECT.TASKS_DIR, base);
  }

  if (!taskFilePath) throw new Error('Could not resolve task path from drop data');
  if (!fs.existsSync(taskFilePath)) throw new Error(`Task file not found: ${taskFilePath}`);
  
  return taskFilePath;
}

// Helper to parse task metadata from file
private getTaskMetadata(taskFilePath: string, sprintFilePath: string) {
  const taskMatter = matter(fs.readFileSync(taskFilePath, 'utf8'));
  const taskName = taskMatter.data.title || taskMatter.data.name ||
    path.basename(taskFilePath, '.md').replace(/^\[Task\]_?/i, '').replace(/[-_]+/g, ' ').trim();

  return {
    name: taskName,
    status: taskMatter.data.status || 'not-started',
    file: path.relative(path.dirname(sprintFilePath), taskFilePath).replace(/\\/g, '/'),
    description: taskMatter.data.description || '',
    priority: taskMatter.data.priority || 'medium',
    type: taskMatter.data.type || 'feature'
  };
}

// Helper to add task to sprint file
private async addTaskToSprint(sprintFilePath: string, taskData: any) {
  const sprintContent = fs.readFileSync(sprintFilePath, 'utf8');
  const sprintMatter = matter(sprintContent);
  if (!Array.isArray(sprintMatter.data.tasks)) sprintMatter.data.tasks = [];

  const idx = sprintMatter.data.tasks.findIndex((t: any) => t.file === taskData.file);
  if (idx >= 0) sprintMatter.data.tasks[idx] = taskData;
  else sprintMatter.data.tasks.push(taskData);

  const marker = UI.SECTIONS.TASKS_MARKER;
  if (!sprintMatter.content.includes(marker)) sprintMatter.content += `\n\n${marker}\n`;

  const link = `- [${taskData.name}](${taskData.file})`;
  const pos = sprintMatter.content.indexOf(marker);
  if (pos !== -1) {
    sprintMatter.content = sprintMatter.content.slice(0, pos + marker.length) + "\n" + link + sprintMatter.content.slice(pos + marker.length);
  }

  fs.writeFileSync(sprintFilePath, matter.stringify(sprintMatter.content, sprintMatter.data));
}

// Source-specific handlers
private async handleTaskDropFromTasks(target: SprintsTreeItem, handleData: any): Promise<void> {
  const taskFilePath = this.resolveTaskPath(handleData);
  const taskData = this.getTaskMetadata(taskFilePath, target.filePath!);
  
  const confirmed = await vscode.window.showInformationMessage(
    `Add task "${taskData.name}" to sprint?`,
    { modal: true },
    'Add'
  );
  if (confirmed !== 'Add') return;

  await this.addTaskToSprint(target.filePath!, taskData);
}

private async handleTaskDropFromSprints(target: SprintsTreeItem, handleData: any): Promise<void> {
  const taskFilePath = handleData.filePath;
  if (!taskFilePath || !fs.existsSync(taskFilePath)) throw new Error('Invalid task path from sprint');
  
  const taskData = this.getTaskMetadata(taskFilePath, target.filePath!);
  const confirmed = await vscode.window.showInformationMessage(
    `Move task "${taskData.name}" to this sprint?`,
    { modal: true },
    'Move'
  );
  if (confirmed !== 'Move') return;

  // Add to new sprint and remove from source sprint if provided
  await this.addTaskToSprint(target.filePath!, taskData);
  if (handleData.sourceContainer?.path) {
    // TODO: Implement removal from source sprint
  }
}

private async handleTaskDropFromEpics(target: SprintsTreeItem, handleData: any): Promise<void> {
  const taskFilePath = this.resolveTaskPath(handleData);
  const taskData = this.getTaskMetadata(taskFilePath, target.filePath!);
  
  const confirmed = await vscode.window.showInformationMessage(
    `Add epic task "${taskData.name}" to sprint?`,
    { modal: true },
    'Add'
  );
  if (confirmed !== 'Add') return;

  await this.addTaskToSprint(target.filePath!, taskData);
}

private async handleTaskDropFromBacklogs(target: SprintsTreeItem, handleData: any): Promise<void> {
  const taskFilePath = this.resolveTaskPath(handleData);
  const taskData = this.getTaskMetadata(taskFilePath, target.filePath!);
  
  const confirmed = await vscode.window.showInformationMessage(
    `Move backlog task "${taskData.name}" to sprint?`,
    { modal: true },
    'Move'
  );
  if (confirmed !== 'Move') return;

  await this.addTaskToSprint(target.filePath!, taskData);
}

async handleDrop(target: SprintsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
  try {
    if (!target?.filePath || target.contextValue !== 'sprint') {
      console.log('Drop target invalid or not a sprint');
      return;
    }

    const mimeTypes = {
      tasks: 'application/vnd.code.tree.sprintdesk-tasks',
      sprints: 'application/vnd.code.tree.sprintdesk-sprints',
      epics: 'application/vnd.code.tree.sprintdesk-epics',
      backlogs: 'application/vnd.code.tree.sprintdesk-backlogs'
    };

    // Get first available transfer item
    const dt = Object.values(mimeTypes)
      .map(m => ({ mime: m, data: dataTransfer.get(m) }))
      .find(x => x.data !== undefined && x.data !== null);
    
    if (!dt?.data) {
      console.log('No valid task data found in dataTransfer');
      return;
    }

    const handleData = JSON.parse(dt.data.value as string);
    if (!handleData) {
      console.log('No valid task data in drop');
      return;
    }

    // Route to appropriate handler based on mime type
    switch (dt.mime) {
      case mimeTypes.tasks:
        await this.handleTaskDropFromTasks(target, handleData);
        break;
      case mimeTypes.sprints:
        await this.handleTaskDropFromSprints(target, handleData);
        break;
      case mimeTypes.epics:
        await this.handleTaskDropFromEpics(target, handleData);
        break;
      case mimeTypes.backlogs:
        await this.handleTaskDropFromBacklogs(target, handleData);
        break;
    }

    this.refresh();
    void vscode.window.showInformationMessage(`Task successfully added to sprint`);

  } catch (err: any) {
    console.error('Drop error:', err);
    void vscode.window.showErrorMessage(`Failed to add task to sprint: ${err.message || err}`);
  }
}



private updateSprintTasks(sprintMatter: matter.GrayMatterFile<string>, taskData: any) {
  const idx = sprintMatter.data.tasks.findIndex((t: any) => t.file === taskData.file);
  if (idx >= 0) {
    sprintMatter.data.tasks[idx] = taskData;
  } else {
    sprintMatter.data.tasks.push(taskData);
  }

  const marker = UI.SECTIONS.TASKS_MARKER;
  if (!sprintMatter.content.includes(marker)) {
    sprintMatter.content += `\n\n${marker}\n`;
  }

  // Add task link without emoji
  const link = `- [${taskData.name}](${taskData.file})`;
  const pos = sprintMatter.content.indexOf(marker);
  if (pos !== -1) {
    sprintMatter.content = sprintMatter.content.slice(0, pos + marker.length) + 
      "\n" + link + sprintMatter.content.slice(pos + marker.length);
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
