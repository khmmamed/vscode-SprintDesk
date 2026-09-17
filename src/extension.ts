import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// commands
import { registerRefreshCommand } from './commands/refreshCommand';
// Provider
import { HistoryTreeDataProvider, historyTreeDataProvider } from './providers/history/HistoryTreeDataProvider';
import { workforceTreeDataProvider } from './providers/workforce/WorkforceTreeDataProvider';
import { SprintDeskTreeDataProvider } from './providers/SprintDeskTreeDataProvider';
import { requestsTreeDataProvider } from './providers/requests/RequestsTreeDataProvider';
import { plansTreeDataProvider } from './providers/plans/PlansTreeDataProvider';
import { findingsTreeDataProvider } from './providers/findings/FindingsTreeDataProvider';
import { approvalsTreeDataProvider } from './providers/approvals/ApprovalsTreeDataProvider';
import { schedulesTreeDataProvider } from './providers/schedules/SchedulesTreeDataProvider';
import { workflowsTreeDataProvider } from './providers/workflows/WorkflowsTreeDataProvider';
import { mcpTreeDataProvider } from './providers/mcp/McpTreeDataProvider';
import { toolsTreeDataProvider } from './providers/tools/ToolsTreeDataProvider';
import { activityTreeDataProvider } from './providers/activity/ActivityTreeDataProvider';
// Services
import { registerWorkforceCommands } from './commands/workforce/workforceCommands';
import { registerWorkforceControlCenter } from './commands/workforce/openWorkforceControlCenter';
import { registerSectionCommands } from './commands/sections/sectionCommands';
import { installDispatcher } from './services/workforce/plan/dispatcher';
import { installRecovery } from './services/workforce/plan/recovery';
import { installValidator } from './services/workforce/plan/validator';
import { startScheduler } from './services/workforce/scheduler/organizerEngine';
import { subscribeEvents } from './services/workforce/events';
import { getStores } from './data/stores';
// Host boundary
import { setHost, setFileSystem } from './host';
import { VSCodeHost } from './host/VSCodeHost';
import { NodeFileSystem } from './host/NodeFileSystem';
import { buildMcpManifest, buildMcpReadme } from './mcp/manifest';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize host boundary (VSCode host + synchronous file system)
  setHost(new VSCodeHost());
  setFileSystem(new NodeFileSystem());

  const historyProvider: HistoryTreeDataProvider = historyTreeDataProvider;
  const workforceProvider = workforceTreeDataProvider;

  const sprintDeskProvider = new SprintDeskTreeDataProvider({
    people: workforceProvider as any,
    mcp: mcpTreeDataProvider,
    tools: toolsTreeDataProvider,
    requests: requestsTreeDataProvider,
    plans: plansTreeDataProvider,
    findings: findingsTreeDataProvider,
    approvals: approvalsTreeDataProvider,
    schedules: schedulesTreeDataProvider,
    workflows: workflowsTreeDataProvider,
    activity: activityTreeDataProvider,
    history: historyProvider as any
  });
  context.subscriptions.push(sprintDeskProvider);

  const sprintDeskTreeView = vscode.window.createTreeView('sprintdesk-main', {
    treeDataProvider: sprintDeskProvider,
    dragAndDropController: sprintDeskProvider
  });
  context.subscriptions.push(sprintDeskTreeView);

  registerRefreshCommand(context, {
    historyProvider,
    workforceProvider
  });

  // Workforce commands
  registerWorkforceCommands(context, workforceProvider);
  registerWorkforceControlCenter(context);

  // v1.0 Slice T — Control Center section commands + live event-driven refresh.
  registerSectionCommands(context, sprintDeskProvider);

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) {return;}
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      sprintDeskProvider.refresh();
    }, 300);
  };
  const disposeEventRefresh = subscribeEvents(scheduleRefresh);
  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {clearTimeout(refreshTimer);}
      disposeEventRefresh();
    }
  });

  // v1.0 Slice F — organize engine wiring. The Dispatcher translates Organizer
  // decisions into queue work; the scheduler driver honors queueSettings.enabled /
  // pollIntervalMs and installs event-path organizer triggers. Both are inert until
  // the user opts in (queueSettings.enabled defaults to false).
  // v1.0 Slice J — the Validator is the last runtime stage: it turns a
  // completed execution into a validation decision + checkpoint, then requests
  // the human deploy authorization. checkpointService owns those transitions.
  const disposeDispatcher = installDispatcher();
  const disposeRecovery = installRecovery();
  const disposeValidator = installValidator();
  const schedulerDriver = startScheduler();
  context.subscriptions.push({ dispose: disposeDispatcher });
  context.subscriptions.push({ dispose: disposeRecovery });
  context.subscriptions.push({ dispose: disposeValidator });
  context.subscriptions.push({ dispose: () => schedulerDriver.stop() });

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

  // === Ensure .SprintDesk folder structure on activation ===
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const ws = workspaceFolders[0].uri.fsPath;
    const sdPath = path.join(ws, '.SprintDesk');

// Ensure all directories exist
    const dirs = ['database', 'people', 'settings', 'mcp', 'plans', 'inputs'];
    for (const dir of dirs) {
      const fullPath = path.join(sdPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // v1.0 — database/ is the single runtime-state boundary; seed the registry
    // files (executions.yml keeps its internal `runs` key). Slice K relocated the
    // former workforce/ state stores (findings, approvals, skills, eventRules,
    // classification, executionWindows, policy) here.
    const dbFiles = new Map<string, string>([
      ['inputs.yml', 'inputs'],
      ['plans.yml', 'plans'],
      ['cycles.yml', 'cycles'],
      ['checkpoints.yml', 'checkpoints'],
      ['executions.yml', 'runs'],
      ['events.yml', 'events'],
      ['audit.yml', 'entries'],
      ['findings.yml', 'findings'],
      ['approvals.yml', 'approvals'],
      ['skills.yml', 'skills'],
      ['tools.yml', 'tools'],
      ['eventRules.yml', 'eventRules'],
      ['classification.yml', 'proposals'],
      ['executionWindows.yml', 'executionWindows']
    ]);
    for (const [file, key] of dbFiles) {
      const dbPath = path.join(sdPath, 'database', file);
      if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, `${key}: []`, 'utf8');
      }
    }

    // Seed the catalogs the Control Center tools/capability views read from.
    getStores(ws).tools.seedDefaultTools();
    getStores(ws).skills.seedDefaultSkills();

// Ensure MCP files exist
    const mcpManifestPath = path.join(sdPath, 'mcp', 'manifest.json');
    const mcpManifest = buildMcpManifest();
    fs.writeFileSync(mcpManifestPath, JSON.stringify(mcpManifest, null, 2), 'utf8');

    // Rewritten on every activation so the artifact tracks the live registry.
    const mcpReadmePath = path.join(sdPath, 'mcp', 'README.md');
    fs.writeFileSync(mcpReadmePath, buildMcpReadme(), 'utf8');

    vscode.window.showInformationMessage("📦 SprintDesk ready!");
  } catch (err) {
    console.error('Failed to create SprintDesk folder structure:', err);
  }
}

export function deactivate() { }