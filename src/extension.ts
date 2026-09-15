import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// webview
// commands
import {
  registerAddSprintCommand,
  registerAddExistingTasksToSprintCommand,
  registerShowSprintCalendarCommand,
  registerOpenSprintFileCommand,
  registerAddBacklogCommand,
  registerAddTaskToBacklogCommand,
  registerAddExistingTasksToBacklogCommand,
  registerAddEpicCommand,
  registerAddTaskToEpicCommand,
  registerAddQuicklyCommand,
  registerStartFeatureFromTaskCommand,
  registerCreateTaskFromRepoCommand,
  registerCreateEpicFromRepoCommand,
  registerCreateSprintFromRepoCommand,
  registerCreateBacklogFromRepoCommand,
  registerOpenWebviewCommand,
  registerViewTaskPreviewCommand,
  registerEditTaskRawCommand,
  registerViewEpicsCommand,
  registerViewBacklogsCommand,
  addMultipleTasksCommand,
  registerAddTaskCommand,
  registerSetTaskStatusCommand
} from './commands';
import { registerViewProjectStructureCommand } from "./commands/viewProjectStructure";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerRefreshCommand } from './commands/refreshCommand';
import { registerScanProjectStructureCommand } from './commands/scanProjectStructureCommand';
import {
  registerOpenSettingsCommand
} from './commands';
// Provider
import { SprintsTreeDataProvider } from './providers/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './providers/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './providers/BacklogsTreeDataProvider';
import { EpicsTreeDataProvider } from './providers/EpicsTreeDataProvider';
import { RepositoriesTreeDataProvider } from './providers/RepositoriesTreeDataProvider';
import { RepositoryStateService } from './services/repositoryState';
import * as fileService from './services/fileService';
import { HistoryTreeDataProvider, historyTreeDataProvider } from './providers/history/HistoryTreeDataProvider';
import { workforceTreeDataProvider } from './providers/workforce/WorkforceTreeDataProvider';
import { SprintDeskTreeDataProvider } from './providers/SprintDeskTreeDataProvider';
// Services
import { createSprintInteractive, addExistingTasksToSprint, startFeatureFromTask } from './commands/interactive/sprintInteractive';
import { createEpicInteractive } from './commands/interactive/epicInteractive';
import { addTaskToBacklogInteractive, addExistingTasksToBacklog, createBacklogInteractive } from './commands/interactive/backlogInteractive';
import { registerWorkforceCommands } from './commands/workforce/workforceCommands';
import { registerWorkforceControlCenter } from './commands/workforce/openWorkforceControlCenter';
import * as capabilityService from './services/workforce/capabilityService';
// Tasks - import and create wrapper for API compatibility
import { createTask as createTaskService } from "./services/taskService";
// Host boundary
import { setHost, setFileSystem } from './host';
import { VSCodeHost } from './host/VSCodeHost';
import { NodeFileSystem } from './host/NodeFileSystem';
import { buildMcpManifest } from './mcp/manifest';

const createTask = async (repoPath?: string): Promise<void> => {
  const ws = repoPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Task title',
    placeHolder: 'Enter task title...'
  });
  if (!title) return;

  const type = await vscode.window.showQuickPick(['feature', 'bug', 'chore', 'doc', 'test'], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  const priority = await vscode.window.showQuickPick(['high', 'medium', 'low'], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  const backlog = await vscode.window.showInputBox({
    prompt: 'Backlog name',
    placeHolder: 'features',
    value: 'features'
  });

  // Get existing epics for selection
  const { getDataService } = require('./data/DataService');
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();

  let epicSelection: string | undefined;
  if (epics.length > 0) {
    const epicOptions = [{ label: '(None)', value: null }, ...epics.map((e: any) => ({
      label: `[${e.code}] ${e.title}`,
      value: e.id
    }))];

    const selectedEpic = await vscode.window.showQuickPick(epicOptions, {
      placeHolder: 'Select epic (optional)'
    });
    epicSelection = selectedEpic?.value ?? null;
  }

  await createTaskService(ws, {
    title,
    type,
    status: 'waiting',
    priority,
    backlog: backlog || 'features',
    epic: epicSelection
  });

  vscode.window.showInformationMessage(`Task "${title}" created.`);
};

// existing tasks dir helper moved to services/fileService

export async function activate(context: vscode.ExtensionContext) {
  // Initialize host boundary (VSCode host + synchronous file system)
  setHost(new VSCodeHost());
  setFileSystem(new NodeFileSystem());

  const repoState = new RepositoryStateService(context.globalState);

  registerOpenWebviewCommand(context);
  registerViewTaskPreviewCommand(context);
  registerEditTaskRawCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);
  registerViewProjectStructureCommand(context);
  registerViewEpicsCommand(context);

  const sprintsProvider = new SprintsTreeDataProvider();
  const backlogsProvider = new BacklogsTreeDataProvider();
  const repositoriesProvider = new RepositoriesTreeDataProvider(repoState);

  const tasksProvider = new TasksTreeDataProvider();
  const epicsProvider = new EpicsTreeDataProvider();

  const historyProvider = historyTreeDataProvider;
  const workforceProvider = workforceTreeDataProvider;

  const sprintDeskProvider = new SprintDeskTreeDataProvider({
    repositories: repositoriesProvider as any,
    tasks: tasksProvider as any,
    sprints: sprintsProvider as any,
    backlogs: backlogsProvider as any,
    epics: epicsProvider as any,
    workforce: workforceProvider as any,
    history: historyProvider as any
  });
  context.subscriptions.push(sprintDeskProvider);

  const sprintDeskTreeView = vscode.window.createTreeView('sprintdesk-main', {
    treeDataProvider: sprintDeskProvider,
    dragAndDropController: sprintDeskProvider
  });
  context.subscriptions.push(sprintDeskTreeView);

  // Register delegated commands (one file per command)
  registerAddTaskCommand(context, { repositoriesTreeView: sprintDeskTreeView, createTask, tasksProvider, sprintsProvider });
  registerScanProjectStructureCommand(context);
  registerAddSprintCommand(context, { createSprintInteractive });
  registerAddEpicCommand(context, { createEpicInteractive, epicsProvider });
  registerAddExistingTasksToSprintCommand(context, { addExistingTasksToSprint });
  registerAddBacklogCommand(context, { createBacklogInteractive });
  registerAddTaskToBacklogCommand(context, { addTaskToBacklogInteractive });
  registerAddExistingTasksToBacklogCommand(context, { addExistingTasksToBacklog });
  registerAddTaskToEpicCommand(context, { epicsProvider, tasksProvider });

  // Register repository commands
  registerCreateTaskFromRepoCommand(context, { repositoriesTreeView: sprintDeskTreeView, tasksProvider, sprintsProvider, epicsProvider, backlogsProvider });
  registerCreateEpicFromRepoCommand(context, { repositoriesTreeView: sprintDeskTreeView, epicsProvider, tasksProvider, sprintsProvider, backlogsProvider });
  registerCreateSprintFromRepoCommand(context, { repositoriesTreeView: sprintDeskTreeView, sprintsProvider, tasksProvider, epicsProvider, backlogsProvider });
  registerCreateBacklogFromRepoCommand(context, { repositoriesTreeView: sprintDeskTreeView, backlogsProvider, tasksProvider, sprintsProvider, epicsProvider });
registerRefreshCommand(context, { sprintsProvider, backlogsProvider, repositoriesProvider, tasksProvider, epicsProvider, historyProvider, workforceProvider });
  registerStartFeatureFromTaskCommand(context, { startFeatureFromTask });
  registerSetTaskStatusCommand(context);
  registerOpenSprintFileCommand(context);
  registerShowSprintCalendarCommand(context);

  // History commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.viewHistory', async () => {
      historyProvider.refresh();
    }),
    vscode.commands.registerCommand('sprintdesk.getItemHistory', async () => {
      const itemId = await vscode.window.showInputBox({ prompt: 'Enter item ID' });
      const itemType = await vscode.window.showQuickPick(['task', 'epic', 'sprint', 'backlog'], { placeHolder: 'Select item type' });
      if (itemId && itemType) {
        const { getHistoryForItem } = require('./services/history/historyService');
        const history = getHistoryForItem(itemId, itemType);
        vscode.window.showInformationMessage(`Found ${history.internal.length} internal and ${history.git.length} git entries`);
      }
    }),
    vscode.commands.registerCommand('sprintdesk.recommendAssignee', async (item: any) => {
      const task = item?.taskObj;
      if (!task) {
        vscode.window.showWarningMessage('Select a task first');
        return;
      }
      const results = capabilityService.recommendEmployees(
        { type: task.type, requiredSkills: task.requiredSkills },
        { includePartial: true, maxResults: 8 }
      );
      if (results.length === 0) {
        vscode.window.showInformationMessage('No capable employees found in workforce');
        return;
      }
      const choice = await vscode.window.showQuickPick(
        results.map(r => ({
          label: r.employee.name,
          description:
            `${Math.round(r.evaluation.coverage * 100)}% matched · ${r.employee.role} · ${r.employee.status || 'idle'} · load ${r.load}`,
          detail:
            r.evaluation.missing.length > 0
              ? r.rankKey + ' · missing: ' + r.evaluation.missing.join(', ')
              : r.rankKey + ' · full match',
          value: r.employee
        })),
        { placeHolder: 'Recommended assignee (skill coverage -> load -> idle -> name)' }
      );
      if (!choice) return;

      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const { getDataService } = require('./data/DataService');
      const ds = ws ? getDataService(ws) : undefined;
      if (ds) {
        ds.updateTask(task.id, { agent: choice.value.id });
        const updatedTask = ds.getTask(task.id);
        if (updatedTask) ds.saveTaskMd(updatedTask);
      }
      tasksProvider.refresh();
      vscode.window.showInformationMessage(`Recommended ${choice.value.name} for ${task.code || task.title}`);
    })
  );

  // Workforce commands
  registerWorkforceCommands(context, workforceProvider);
  registerWorkforceControlCenter(context);

// Settings commands
  registerOpenSettingsCommand(context);

  // MCP server - auto-start on extension load
  const { createMcpHttpTransport } = require('./mcp/httpServer');
  let mcpServer: any = null;

  const startMcpServer = () => {
    if (mcpServer) return;
    mcpServer = createMcpHttpTransport({
      onListen: (port: number) => {
        console.log(`🚀 MCP server running on port ${port}`);
        vscode.window.showInformationMessage(`🚀 MCP server running on port ${port}`);
      }
    });
  };
  
  // Start MCP server automatically
  startMcpServer();

  // Register MCP server definition for VS Code native MCP integration
  const didChangeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('sprintdesk-mcp', {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,
      provideMcpServerDefinitions: async () => {
        const serverDef = new vscode.McpHttpServerDefinition(
          'SprintDesk MCP',
          vscode.Uri.parse('http://localhost:3847/mcp'),
          {},
          '1.0.0'
        );
        return [serverDef];
      },
      resolveMcpServerDefinition: async (server) => {
        return server;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startMcp', async () => {
      if (mcpServer) {
        vscode.window.showInformationMessage('MCP server already running on port 3847');
        return;
      }
      startMcpServer();
    })
  );

  // Selecting an item from the Repositories section changes the active repository.
  sprintDeskTreeView.onDidChangeSelection(e => {
    try {
      const sel = (e.selection && e.selection[0]) as any;
      if (!sel || !['repo', 'category', 'item'].includes(sel.nodeType)) return;
      let selectedPath = sel?.fullPath ?? sel?.resourceUri?.fsPath;
      let repoPath: string | undefined = undefined;
      if (selectedPath) {
        if (sel?.nodeType === 'repo' || sel?.nodeType === 'category') {
          repoPath = sel.fullPath || sel.resourceUri?.fsPath;
        } else {
          const parts = String(selectedPath).split(path.sep);
          const sdIndex = parts.indexOf('.SprintDesk');
          if (sdIndex > 0) {
            repoPath = parts.slice(0, sdIndex).join(path.sep);
          } else {
            repoPath = path.resolve(selectedPath, '..', '..', '..');
          }
        }
      }

      if (repoPath) {
        repoState.setActiveRepo(repoPath);
        fileService.setWorkspaceRootOverride(repoPath);
        (tasksProvider as any).setWorkspaceRoot?.(repoPath);
        (backlogsProvider as any).setWorkspaceRoot?.(repoPath);
        (epicsProvider as any).setWorkspaceRoot?.(repoPath);
        (sprintsProvider as any).setWorkspaceRoot?.(repoPath);
        (historyProvider as any).setWorkspaceRoot?.(repoPath);
      } else {
        repoState.setActiveRepo(undefined);
        fileService.setWorkspaceRootOverride(undefined);
        (tasksProvider as any).setWorkspaceRoot?.(undefined);
        (backlogsProvider as any).setWorkspaceRoot?.(undefined);
        (epicsProvider as any).setWorkspaceRoot?.(undefined);
        (sprintsProvider as any).setWorkspaceRoot?.(undefined);
        (historyProvider as any).setWorkspaceRoot?.(undefined);
      }
    } catch (err) {
      console.error('Failed to switch providers on repo selection', err);
    }
  });

  // Listen for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(e => {
      repositoriesProvider.updateWorkspaceRoots();
      repositoriesProvider.refresh();
    })
  );

  // Restore active repo on startup
  const activeRepo = repoState.getActiveRepo();
  if (activeRepo) {
    fileService.setWorkspaceRootOverride(activeRepo);
    (tasksProvider as any).setWorkspaceRoot?.(activeRepo);
    (backlogsProvider as any).setWorkspaceRoot?.(activeRepo);
    (epicsProvider as any).setWorkspaceRoot?.(activeRepo);
    (sprintsProvider as any).setWorkspaceRoot?.(activeRepo);
    (historyProvider as any).setWorkspaceRoot?.(activeRepo);
  }

  // === Ensure .SprintDesk folder structure on activation ===
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const ws = workspaceFolders[0].uri.fsPath;
    const sdPath = path.join(ws, '.SprintDesk');

// Ensure all directories exist
    const dirs = ['data', 'Tasks', 'Backlogs', 'Epics', 'Sprints', 'mcp', 'people', 'workforce', 'database', 'plans', 'inputs'];
    for (const dir of dirs) {
      const fullPath = path.join(sdPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // Ensure data files exist
    const dataFiles = ['tasks.yml', 'backlogs.yml', 'epics.yml', 'sprints.yml'];
    for (const file of dataFiles) {
      const dataPath = path.join(sdPath, 'data', file);
      if (!fs.existsSync(dataPath)) {
        const key = file.replace('.yml', '');
        fs.writeFileSync(dataPath, `${key}: []`, 'utf8');
      }
    }

    // v1.0 Slice A — database/ is the single runtime-state boundary; seed the new
    // registry files (executions.yml keeps its internal `runs` key)
    const dbFiles = new Map<string, string>([
      ['inputs.yml', 'inputs'],
      ['plans.yml', 'plans'],
      ['cycles.yml', 'cycles'],
      ['checkpoints.yml', 'checkpoints'],
      ['executions.yml', 'runs'],
      ['events.yml', 'events'],
      ['audit.yml', 'entries']
    ]);
    for (const [file, key] of dbFiles) {
      const dbPath = path.join(sdPath, 'database', file);
      if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, `${key}: []`, 'utf8');
      }
    }

// Ensure MCP files exist
    const mcpManifestPath = path.join(sdPath, 'mcp', 'manifest.json');
    const mcpManifest = buildMcpManifest();
    fs.writeFileSync(mcpManifestPath, JSON.stringify(mcpManifest, null, 2), 'utf8');

    const mcpReadmePath = path.join(sdPath, 'mcp', 'README.md');
    if (!fs.existsSync(mcpReadmePath)) {
      const readme = `# SprintDesk MCP Server

Local MCP server for integrating SprintDesk with AI agents like Copilot, Claude, etc.

## Available Tools

### Task Tools
- sprintdesk_createTask, sprintdesk_getTask, sprintdesk_updateTask, sprintdesk_deleteTask
- sprintdesk_listTasks, sprintdesk_searchTasks

### Epic Tools  
- sprintdesk_createEpic, sprintdesk_getEpic, sprintdesk_updateEpic, sprintdesk_deleteEpic
- sprintdesk_listEpics, sprintdesk_getTasksByEpic, sprintdesk_addTaskToEpic

### Sprint Tools
- sprintdesk_createSprint, sprintdesk_getSprint, sprintdesk_updateSprint, sprintdesk_deleteSprint
- sprintdesk_listSprints, sprintdesk_getTasksBySprint, sprintdesk_addTaskToSprint

### Backlog Tools
- sprintdesk_createBacklog, sprintdesk_getBacklog, sprintdesk_listBacklogs, sprintdesk_addTaskToBacklog

### Move Tools
- sprintdesk_moveTaskToEpic, sprintdesk_moveTaskToSprint, sprintdesk_moveTaskToBacklog

### Workflow Tools
- sprintdesk_tasksClaim, sprintdesk_tasksComplete, sprintdesk_tasksAssign, sprintdesk_tasksUnassign
- sprintdesk_tasksAutoAssign

### Workforce Tools
- sprintdesk_agentsList, sprintdesk_agentsGet

### Run Tools
- sprintdesk_runsCreate, sprintdesk_runsList, sprintdesk_runsGet
- sprintdesk_runsCancel, sprintdesk_runsUpdate

### Queue Tools
- sprintdesk_queueGet, sprintdesk_queueProcess

### Event & Audit Tools
- sprintdesk_eventsPublish, sprintdesk_eventsList, sprintdesk_auditList

### Context Tools
- sprintdesk_projectContext

## Usage

AI agents can discover and use these tools through the MCP protocol when this extension is active.
`;
      fs.writeFileSync(mcpReadmePath, readme, 'utf8');
    }

    vscode.window.showInformationMessage("📦 SprintDesk ready!");
  } catch (err) {
    console.error('Failed to create SprintDesk folder structure:', err);
  }
}

export function deactivate() { }
