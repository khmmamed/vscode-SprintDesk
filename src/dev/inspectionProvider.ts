import * as vscode from "vscode";
import type { PipelineVersion } from "../kernel/index.js";
import type { Platform } from "../platform/index.js";
import type { StoredNodeAttempt } from "../runtime/index.js";
import type { DevHarness } from "./harness.js";

export class DevInspectionProvider implements vscode.TreeDataProvider<DevItem>, vscode.Disposable {
  private readonly platform: Platform;
  private readonly changeEmitter = new vscode.EventEmitter<DevItem | undefined>();
  private readonly unsubscribeEvents: () => void;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(harness: DevHarness) {
    this.platform = harness.getPlatform();
    this.unsubscribeEvents = this.platform.eventBus?.onAny(() => this.refresh()) ?? (() => undefined);
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.unsubscribeEvents();
    this.changeEmitter.dispose();
  }

  getTreeItem(item: DevItem): vscode.TreeItem {
    return item;
  }

  getChildren(item?: DevItem): DevItem[] {
    if (!item) {
      return [
        this.branch("Pipelines", () => this.getPipelineItems()),
        this.branch("Runs", () => this.getRunItems()),
        this.branch("Schedules", () => this.getScheduleItems()),
        this.branch("Capabilities", () => this.getCapabilityItems()),
        this.branch("Resources", () => this.getResourceItems()),
        this.branch("Artifacts", () => this.getArtifactItems()),
      ];
    }
    return item.loadChildren?.() ?? item.children ?? [];
  }

  private branch(label: string, loadChildren: () => DevItem[]): DevItem {
    return new DevItem({ label, collapsible: vscode.TreeItemCollapsibleState.Collapsed, loadChildren });
  }

  private getPipelineItems(): DevItem[] {
    const pipelines = this.platform.pipelineService.list();
    if (pipelines.length === 0) {
      return [new DevItem({ label: "No pipelines registered" })];
    }
    return pipelines.map((pipeline) => new DevItem({
      label: pipeline.name,
      description: pipeline.id,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: pipeline.versions.map((version) => this.getPipelineVersionItem(pipeline.id, version)),
    }));
  }

  private getPipelineVersionItem(pipelineId: string, version: PipelineVersion): DevItem {
    const lifecycle = this.platform.pipelineService.lifecycle(pipelineId, version.version);
    return new DevItem({
      label: `v${version.version}`,
      description: lifecycle,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Status: ${capitalize(lifecycle)}` }),
        this.branch("Graph", () => this.getGraphItems(version)),
      ],
    });
  }

  private getGraphItems(version: PipelineVersion): DevItem[] {
    return [...version.graph.nodes.values()].map((node) => new DevItem({
      label: node.id,
      description: node.type,
    }));
  }

  private getRunItems(): DevItem[] {
    const runs = this.platform.runControlService.list();
    if (runs.length === 0) {
      return [new DevItem({ label: "No runs registered" })];
    }
    return runs.map((run) => new DevItem({
      label: run.id,
      description: run.status,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Pipeline: ${run.pipeline.name ?? run.pipeline.id}` }),
        new DevItem({ label: `Version: v${run.pipeline.version ?? "?"}` }),
        new DevItem({ label: `Status: ${capitalize(run.status)}` }),
        new DevItem({ label: `Duration: ${formatDuration(run.durationMs)}` }),
        ...(run.error === undefined ? [] : [new DevItem({ label: `Error: ${run.error}` })]),
        this.branch("Nodes", () => this.getNodeRunItems(run.nodes)),
        this.branch("State", () => run.stateVersions.map((version) => new DevItem({ label: `State v${version}` }))),
        this.branch("Timeline", () => this.platform.debuggingService.events(run.id).map((event) => new DevItem({
          label: event.type,
          description: new Date(event.timestamp).toLocaleTimeString(),
        }))),
        this.branch("Artifacts", () => run.artifacts.map((artifact) => new DevItem({
          label: artifact.id,
          description: `${artifact.type}: ${artifact.name}`,
        }))),
      ],
    }));
  }

  private getNodeRunItems(nodeRuns: readonly { nodeId: string; nodeType: string; status: string; error?: string; attempts?: readonly StoredNodeAttempt[]; durationMs?: number; stateVersion?: number }[]): DevItem[] {
    if (nodeRuns.length === 0) {
      return [new DevItem({ label: "No node runs recorded" })];
    }
    return nodeRuns.map((nodeRun) => new DevItem({
      label: `${nodeRun.nodeId} ${statusGlyph(nodeRun.status)}`,
      description: nodeRun.error ?? `${nodeRun.status}, ${formatDuration(nodeRun.durationMs)}`,
      collapsible: (nodeRun.attempts?.length ?? 0) > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : undefined,
      children: (nodeRun.attempts ?? []).map((attempt) => this.getAttemptItem(attempt)),
    }));
  }

  private getAttemptItem(attempt: StoredNodeAttempt): DevItem {
    return new DevItem({
      label: `Attempt ${attempt.attempt} ${statusGlyph(attempt.status)}`,
      description: attempt.error ?? `${attempt.status}, ${formatDuration(durationBetween(attempt.startedAt, attempt.finishedAt))}`,
    });
  }

  private getScheduleItems(): DevItem[] {
    const schedules = this.platform.scheduleService.list();
    if (schedules.length === 0) {
      return [new DevItem({ label: "No schedules registered" })];
    }
    return schedules.map((schedule) => new DevItem({
      label: schedule.id,
      description: schedule.enabled ? "enabled" : "disabled",
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Pipeline: ${schedule.pipelineId}` }),
        new DevItem({ label: `Version: v${schedule.version ?? "?"}` }),
        new DevItem({ label: `Trigger: ${schedule.trigger.type}` }),
      ],
    }));
  }

  private getCapabilityItems(): DevItem[] {
    const capabilities = this.platform.capabilityService.list();
    if (capabilities.length === 0) {
      return [new DevItem({ label: "No capabilities registered" })];
    }
    return capabilities.map((capability) => new DevItem({
      label: capability.id,
      description: capability.type,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Version: ${capability.version}` }),
        new DevItem({ label: `Metadata: ${Object.keys(capability.metadata).length} fields` }),
      ],
    }));
  }

  private getResourceItems(): DevItem[] {
    const resources = this.platform.resourceService.list();
    if (resources.length === 0) {
      return [new DevItem({ label: "No resources registered" })];
    }
    return resources.map((resource) => new DevItem({
      label: resource.id,
      description: `${resource.type} v${resource.version}`,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [new DevItem({ label: `Metadata: ${Object.keys(resource.metadata).length} fields` })],
    }));
  }

  private getArtifactItems(): DevItem[] {
    const artifacts = this.platform.artifactService.list();
    if (artifacts.length === 0) {
      return [new DevItem({ label: "No artifacts registered" })];
    }
    return artifacts.map((artifact) => new DevItem({
      label: artifact.id,
      description: `${artifact.type}: ${artifact.name}`,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Reference: ${artifact.ref.kind}` }),
        new DevItem({ label: `Metadata: ${Object.keys(artifact.metadata ?? {}).length} fields` }),
        ...(artifact.lineage === undefined ? [] : [
          new DevItem({ label: `Run: ${artifact.lineage.executionId}` }),
          new DevItem({ label: `Node: ${artifact.lineage.nodeId}` }),
          new DevItem({ label: `Attempt: ${artifact.lineage.attempt}` }),
          ...(artifact.lineage.pipelineId === undefined ? [] : [
            new DevItem({ label: `Pipeline: ${artifact.lineage.pipelineId} v${artifact.lineage.pipelineVersion ?? "?"}` }),
          ]),
        ]),
        ...(artifact.retention === undefined ? [] : [
          new DevItem({ label: `Retention: ${artifact.retention.policy}` }),
        ]),
      ],
    }));
  }
}

class DevItem extends vscode.TreeItem {
  readonly children?: DevItem[];
  readonly loadChildren?: () => DevItem[];

  constructor(options: {
    label: string;
    collapsible?: vscode.TreeItemCollapsibleState;
    children?: DevItem[];
    loadChildren?: () => DevItem[];
    description?: string;
  }) {
    super(options.label, options.collapsible ?? vscode.TreeItemCollapsibleState.None);
    this.description = options.description;
    this.children = options.children;
    this.loadChildren = options.loadChildren;
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function statusGlyph(status: string): string {
  if (status === "succeeded") {
    return "✓";
  }
  if (status === "failed") {
    return "!";
  }
  if (status === "cancelled") {
    return "-";
  }
  return "...";
}

function durationBetween(startedAt?: number, finishedAt?: number): number | undefined {
  if (startedAt === undefined) {
    return undefined;
  }
  return Math.max(0, (finishedAt ?? Date.now()) - startedAt);
}

function formatDuration(durationMs?: number): string {
  return durationMs === undefined ? "in progress" : `${durationMs} ms`;
}
