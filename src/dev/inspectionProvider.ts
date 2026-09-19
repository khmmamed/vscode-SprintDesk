import * as vscode from "vscode";
import type { DevHarness } from "./harness.js";
import { Node } from "../kernel/index.js";
import type { RunStatusInfo } from "../runtime/index.js";
import type { Artifact } from "../runtime/persistence/ArtifactStore.js";
import type { StoredNodeRun } from "../runtime/persistence/RunStore.js";

export class DevInspectionProvider implements vscode.TreeDataProvider<DevItem> {
  private readonly harness: DevHarness;
  private _onDidChangeTreeData = new vscode.EventEmitter<DevItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(harness: DevHarness) {
    this.harness = harness;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(item: DevItem): vscode.TreeItem {
    return item;
  }

  async getChildren(item?: DevItem): Promise<DevItem[]> {
    if (!item) {
      return [
        new DevItem({ 
          label: "Pipelines", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getPipelineItems() 
        }),
        new DevItem({ 
          label: "Runs", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getRunItems() 
        }),
        new DevItem({ 
          label: "Schedules", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getScheduleItems() 
        }),
        new DevItem({ 
          label: "Capabilities", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getCapabilityItems() 
        }),
        new DevItem({ 
          label: "Resources", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getResourceItems() 
        }),
        new DevItem({ 
          label: "Artifacts", 
          collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
          children: this.getArtifactItems() 
        }),
      ];
    }

    if (item.children) {
      return item.children;
    }

    return [];
  }

  private getPipelineItems(): DevItem[] {
    const pipelines = this.harness.listPipelines();
    if (pipelines.length === 0) {
      return [new DevItem({ label: "No pipelines registered" })];
    }

    return pipelines.map(pipeline =>
      new DevItem({
        label: `${pipeline.name} (${pipeline.id})`,
        collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        children: [
          new DevItem({ label: `Latest: v${pipeline.latestVersion()?.version ?? "none"}` }),
          ...pipeline.versions.map(
            version =>
              new DevItem({
                label: `v${version.version}`,
                collapsible: vscode.TreeItemCollapsibleState.Collapsed,
                children: [
                  new DevItem({
                    label: "Graph",
                    collapsible: vscode.TreeItemCollapsibleState.Collapsed,
                    children: this.getGraphItems(version),
                  }),
                ],
              })
          ),
        ],
      })
    );
  }

  private getGraphItems(version: any): DevItem[] {
    const nodes = Array.from(version.graph.nodes.values()) as Node[];
    return nodes.map(node => new DevItem({
      label: `${node.id} (${node.type})`,
      description: `Cap: ${node.capabilityId ?? "none"} | Res: ${node.resourceReferences?.map(r => r.resourceId).join(", ") ?? "none"}`,
    }));
  }

  private getRunItems(): DevItem[] {
    const runtime = this.harness.getRuntime();
    const runs = runtime.runs();
    if (runs.length === 0) {
      return [new DevItem({ label: "No runs registered" })];
    }

    return runs.map(run => {
      const status = runtime.status(run.id);
      return new DevItem({ 
        label: `run-${run.id} [${run.status}]`, 
        collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
        children: [
          new DevItem({ label: `Pipeline: ${run.pipelineId ?? "unnamed"} v${run.pipelineVersion ?? "?"}` }),
          new DevItem({ label: `Started: ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "N/A"}` }),
          new DevItem({ label: `Finished: ${run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "N/A"}` }),
          new DevItem({ label: `Error: ${run.error ?? "None"}` }),
          new DevItem({ 
            label: "Nodes", 
            collapsible: vscode.TreeItemCollapsibleState.Collapsed, 
            children: this.getNodeRunItems(status.nodes) 
          }),
        ]
      });
    });
  }

  private getNodeRunItems(nodeRuns: readonly StoredNodeRun[]): DevItem[] {
    if (nodeRuns.length === 0) {
      return [new DevItem({ label: "No node runs recorded" })];
    }

    return nodeRuns.map(nodeRun => new DevItem({
      label: `${nodeRun.nodeId} (${nodeRun.nodeType}) [${nodeRun.status}]`,
      description: nodeRun.error
        ? `Error: ${nodeRun.error}`
        : nodeRun.stateVersion !== undefined
          ? `State v${nodeRun.stateVersion}`
          : undefined,
    }));
  }

  private getScheduleItems(): DevItem[] {
    const schedules = this.harness.listSchedules();
    if (schedules.length === 0) {
      return [new DevItem({ label: "No schedules registered" })];
    }

    return schedules.map(s => new DevItem({
      label: s.id,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Trigger: ${s.trigger.type}` }),
        new DevItem({ label: `Enabled: ${s.enabled}` }),
        new DevItem({ label: `Pipeline v${s.version.version}` }),
      ]
    }));
  }

  private getCapabilityItems(): DevItem[] {
    const registry = this.harness.getCapabilityRegistry();
    const caps = registry.list();
    if (caps.length === 0) {
      return [new DevItem({ label: "No capabilities registered" })];
    }

    return caps.map(cap => new DevItem({
      label: cap.id,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Type: ${cap.type}` }),
        new DevItem({ label: `Version: ${cap.version}` }),
        new DevItem({ label: `Handler: ${registry.has(cap.id) ? "Registered" : "Missing"}` }),
      ]
    }));
  }

  private getResourceItems(): DevItem[] {
    const registry = this.harness.getResourceRegistry();
    const res = registry.list();
    if (res.length === 0) {
      return [new DevItem({ label: "No resources registered" })];
    }

    return res.map(r => new DevItem({
      label: r.id,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Type: ${r.type}` }),
        new DevItem({ label: `Version: ${r.version}` }),
      ]
    }));
  }

  private getArtifactItems(): DevItem[] {
    const store = this.harness.getArtifactStore();
    const artifacts = store.list();
    if (artifacts.length === 0) {
      return [new DevItem({ label: "No artifacts registered" })];
    }

    return artifacts.map((a: Artifact) => new DevItem({
      label: a.id,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      children: [
        new DevItem({ label: `Type: ${a.type}` }),
        new DevItem({ label: `Name: ${a.name}` }),
        new DevItem({ label: `Ref: ${a.ref.kind}` }),
      ]
    }));
  }
}

class DevItem extends vscode.TreeItem {
  constructor(options: { 
    label: string, 
    collapsible?: vscode.TreeItemCollapsibleState, 
    children?: DevItem[],
    iconPath?: any,
    description?: string
  }) {
    super(options.label, vscode.TreeItemCollapsibleState.None);
    this.description = options.description;
    if (options.collapsible) {
      this.collapsibleState = options.collapsible;
    }
    if (options.children) {
      this.children = options.children;
    }
    if (options.iconPath) {
      this.iconPath = options.iconPath;
    }
  }

  readonly children?: DevItem[];
}
