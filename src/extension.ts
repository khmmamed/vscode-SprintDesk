import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// commands
import { registerRefreshCommand } from './commands/refreshCommand';
// Provider
import { HistoryTreeDataProvider, historyTreeDataProvider } from './providers/history/HistoryTreeDataProvider';
import { workforceTreeDataProvider } from './providers/workforce/WorkforceTreeDataProvider';
import { SprintDeskTreeDataProvider } from './providers/SprintDeskTreeDataProvider';
// Services
import { registerWorkforceCommands } from './commands/workforce/workforceCommands';
import { registerWorkforceControlCenter } from './commands/workforce/openWorkforceControlCenter';
import { installDispatcher } from './services/workforce/plan/dispatcher';
import { installRecovery } from './services/workforce/plan/recovery';
import { startScheduler } from './services/workforce/scheduler/organizerEngine';
// Host boundary
import { setHost, setFileSystem } from './host';
import { VSCodeHost } from './host/VSCodeHost';
import { NodeFileSystem } from './host/NodeFileSystem';
import { buildMcpManifest } from './mcp/manifest';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize host boundary (VSCode host + synchronous file system)
  setHost(new VSCodeHost());
  setFileSystem(new NodeFileSystem());

  const historyProvider: HistoryTreeDataProvider = historyTreeDataProvider;
  const workforceProvider = workforceTreeDataProvider;

  const sprintDeskProvider = new SprintDeskTreeDataProvider({
    workforce: workforceProvider as any,
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

  // v1.0 Slice F — organize engine wiring. The Dispatcher translates Organizer
  // decisions into queue work; the scheduler driver honors queueSettings.enabled /
  // pollIntervalMs and installs event-path organizer triggers. Both are inert until
  // the user opts in (queueSettings.enabled defaults to false).
  const disposeDispatcher = installDispatcher();
  const disposeRecovery = installRecovery();
  const schedulerDriver = startScheduler();
  context.subscriptions.push({ dispose: disposeDispatcher });
  context.subscriptions.push({ dispose: disposeRecovery });
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

### Input Tools
- sprintdesk_inputsList, sprintdesk_inputsIngest

### Plan Tools
- sprintdesk_plansList, sprintdesk_plansReplan, sprintdesk_plansGet

### Organizer Tools
- sprintdesk_organizerRun

### Checkpoint Tools
- sprintdesk_checkpointsList, sprintdesk_checkpointsApproveDeploy, sprintdesk_checkpointsRejectDeploy

### Cycle Tools
- sprintdesk_cyclesList

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