import * as vscode from "vscode";
import { DevHarness } from "./dev/harness.js";
import { DevInspectionProvider } from "./dev/inspectionProvider.js";

export async function activate(context: vscode.ExtensionContext) {
  const storageDir = context.globalStorageUri.fsPath;
  const dev = new DevHarness({
    runStoreFile: `${storageDir}/runs.json`,
    scheduleStoreFile: `${storageDir}/schedules.json`,
    pipelineStoreFile: `${storageDir}/pipelines.json`,
  });
  const inspectionProvider = new DevInspectionProvider(dev);
  
  const treeView = vscode.window.createTreeView('sprintdesk-main', {
    treeDataProvider: inspectionProvider
  });
  
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.executeDevPipeline', async () => {
      try {
        await dev.runExample();
        inspectionProvider.refresh();
        vscode.window.showInformationMessage("✅ Dev Pipeline executed successfully");
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Execution failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.executeCancellationPipeline', async () => {
      try {
        await dev.runCancellationExample();
        inspectionProvider.refresh();
        vscode.window.showInformationMessage("🚀 Cancellation Test Pipeline started");
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Execution failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.cancelActiveRun', async () => {
      try {
        const cancelled = dev.cancelRun();
        if (cancelled) {
          vscode.window.showInformationMessage("🛑 Cancellation signal sent");
        } else {
          vscode.window.showWarningMessage("⚠️ No active run to cancel");
        }
        inspectionProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Cancellation failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.refreshDevInspection', () => {
      inspectionProvider.refresh();
      vscode.window.showInformationMessage("🔄 Inspection tree refreshed");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.scheduleDevPipeline', async () => {
      try {
        const schedule = dev.scheduleIntervalPipeline('dev-schedule', 1000);
        inspectionProvider.refresh();
        vscode.window.showInformationMessage(
          `📅 Scheduled "${schedule.pipelineId}" every 1s (v${schedule.version ?? "latest"})`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Scheduling failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.triggerDevSchedule', async () => {
      try {
        const runId = dev.triggerPipeline('dev-schedule');
        inspectionProvider.refresh();
        vscode.window.showInformationMessage(`🚀 Triggered schedule -> run ${runId}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Trigger failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.listDevSchedules', async () => {
      const schedules = dev.listSchedules();
      if (schedules.length === 0) {
        vscode.window.showWarningMessage("⚠️ No schedules registered. Run 'SprintDesk: Schedule Dev Pipeline' first.");
        return;
      }
      const summary = schedules.map((schedule) => `${schedule.id} (${schedule.pipelineId} v${schedule.version ?? "latest"})`).join(", ");
      vscode.window.showInformationMessage(`📋 Schedules: ${summary} | Runs: ${dev.getRunCount()}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.scheduleEventDevPipeline', async () => {
      try {
        const schedule = dev.scheduleEventPipeline('dev-event-schedule', 'dev.tick');
        inspectionProvider.refresh();
        vscode.window.showInformationMessage(
          `📡 Scheduled "${schedule.pipelineId}" on event "dev.tick" (v${schedule.version ?? "latest"})`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Event scheduling failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.emitDevEvent', async () => {
      dev.publishDevEvent('dev.tick');
      inspectionProvider.refresh();
      vscode.window.showInformationMessage("📣 Published dev.tick event");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startScheduler', async () => {
      dev.startScheduler();
      inspectionProvider.refresh();
      vscode.window.showInformationMessage("▶️ Scheduler started");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.stopScheduler', async () => {
      dev.stopScheduler();
      inspectionProvider.refresh();
      vscode.window.showInformationMessage("⏹ Scheduler stopped (timers cleared)");
    })
  );

  vscode.window.showInformationMessage("📦 SprintDesk Dev Harness ready!");
}

export function deactivate() { }

