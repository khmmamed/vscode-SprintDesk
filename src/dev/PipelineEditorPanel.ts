import * as vscode from "vscode";
import type { PipelineEditorSession, EditorSnapshot, Platform } from "../platform/index.js";

export class PipelineEditorPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly session: PipelineEditorSession;
  private disposed = false;

  private constructor(panel: vscode.WebviewPanel, session: PipelineEditorSession) {
    this.panel = panel;
    this.session = session;
    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage((message: EditorMessage) => this.handle(message));
    this.panel.onDidDispose(() => {
      this.disposed = true;
    });
    this.postState();
  }

  static open(extensionUri: vscode.Uri, platform: Platform, pipelineId: string, version: number): void {
    const panel = vscode.window.createWebviewPanel(
      "sprintdesk.pipelineEditor",
      `Edit ${pipelineId} v${version}`,
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );
    new PipelineEditorPanel(panel, platform.openPipelineEditor(pipelineId, version));
  }

  private handle(message: EditorMessage): void {
    try {
      switch (message.type) {
        case "ready":
          break;
        case "addNode":
          if (this.session.state.snapshot().nodes.some((node) => node.id === message.options.id)) {
            this.session.state.updateNode(message.options);
          } else {
            this.session.state.addNode(message.options);
          }
          break;
        case "updateNode":
          this.session.state.updateNode(message.options);
          break;
        case "removeNode":
          this.session.state.removeNode(message.nodeId);
          break;
        case "addEdge":
          this.session.state.addEdge(message.from, message.to, message.label || undefined);
          break;
        case "removeEdge":
          this.session.state.removeEdge(message.from, message.to);
          break;
        case "updateSchema":
          this.session.state.updateStateSchema(message.schema);
          break;
        case "updateMetadata":
          this.session.state.updateMetadata(message.metadata);
          break;
        case "undo":
          this.session.state.undo();
          break;
        case "redo":
          this.session.state.redo();
          break;
        case "save":
          this.session.save();
          break;
        case "validate":
          this.session.validate();
          break;
        case "publish":
          this.session.publish();
          break;
      }
      this.postState();
    } catch (error) {
      this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private postState(): void {
    this.post({
      type: "state",
      state: this.session.state.snapshot(),
      lifecycle: this.session.lifecycle,
      pipelineId: this.session.pipelineId,
      capabilities: this.session.capabilities,
      resources: this.session.resources,
    });
  }

  private post(message: EditorResponse): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }

  private renderHtml(): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SprintDesk Pipeline Editor</title>
<style>
:root { color-scheme: light dark; --border: var(--vscode-panel-border); --muted: var(--vscode-descriptionForeground); --accent: var(--vscode-button-background); }
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; padding: 18px; }
main { max-width: 1100px; margin: 0 auto; }
header, section { border: 1px solid var(--border); padding: 14px; margin-bottom: 12px; }
h1, h2 { margin: 0 0 10px; font-weight: 600; }
.toolbar, .form-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button, input, textarea, select { font: inherit; color: inherit; background: var(--vscode-input-background); border: 1px solid var(--border); padding: 6px 8px; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
button.secondary { background: transparent; color: var(--vscode-foreground); }
input { min-width: 120px; }
textarea { width: 100%; min-height: 70px; box-sizing: border-box; }
.muted { color: var(--muted); }
.status { margin-left: auto; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.node, .edge { border-left: 3px solid var(--accent); padding: 8px 10px; background: var(--vscode-textCodeBlock-background); }
.node strong { display: block; }
.error { color: var(--vscode-errorForeground); min-height: 1.4em; }
label { color: var(--muted); font-size: 0.9em; }
</style>
</head>
<body>
<main>
<header><div class="toolbar"><div><h1 id="title">Pipeline Editor</h1><div id="subtitle" class="muted"></div></div><div class="status" id="status"></div></div></header>
<section><div class="toolbar"><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="save">Save Draft</button><button data-action="validate">Validate</button><button data-action="publish">Publish</button></div><div id="error" class="error"></div></section>
<section><h2>Graph</h2><div id="nodes" class="grid"></div><h2>Edges</h2><div id="edges" class="grid"></div></section>
<section><h2>Node configuration</h2><div class="form-row"><label>Id <input id="node-id"></label><label>Type <input id="node-type"></label><label>Capability <select id="node-capability"><option value="">None</option></select></label><label>Resource <select id="node-resource"><option value="">None</option></select></label><button data-action="add-node">Add / Update Node</button><button class="secondary" data-action="remove-node">Remove Node</button></div></section>
<section><h2>Edge editing</h2><div class="form-row"><label>From <input id="edge-from"></label><label>To <input id="edge-to"></label><button data-action="add-edge">Add Edge</button><button class="secondary" data-action="remove-edge">Remove Edge</button></div></section>
<section><h2>State schema</h2><textarea id="schema"></textarea><button data-action="schema">Apply Schema JSON</button></section>
<section><h2>Pipeline metadata</h2><textarea id="metadata"></textarea><button data-action="metadata">Apply Metadata JSON</button></section>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let current;
const $ = (id) => document.getElementById(id);
const send = (type, payload = {}) => vscode.postMessage({ type, ...payload });
document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
  const action = button.dataset.action;
  if (action === 'add-node') send('addNode', { options: nodeOptions() });
  else if (action === 'remove-node') send('removeNode', { nodeId: $('node-id').value.trim() });
  else if (action === 'add-edge') send('addEdge', { from: $('edge-from').value.trim(), to: $('edge-to').value.trim() });
  else if (action === 'remove-edge') send('removeEdge', { from: $('edge-from').value.trim(), to: $('edge-to').value.trim() });
  else if (action === 'schema') send('updateSchema', { schema: JSON.parse($('schema').value) });
  else if (action === 'metadata') send('updateMetadata', { metadata: JSON.parse($('metadata').value) });
  else send(action);
}));
function nodeOptions() {
  const id = $('node-id').value.trim();
  const type = $('node-type').value.trim();
  const capabilityId = $('node-capability').value || undefined;
  const resourceId = $('node-resource').value || undefined;
  return { id, type, ...(capabilityId ? { capabilityId } : {}), ...(resourceId ? { resourceReferences: [{ resourceId }] } : {}) };
}
function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function render(message) {
  current = message;
  $('title').textContent = message.pipelineId;
  $('subtitle').textContent = 'Pipeline version v' + message.state.version;
  $('status').textContent = message.lifecycle + (message.state.dirty ? ' *' : '');
  $('nodes').innerHTML = message.state.nodes.map((node) => '<div class="node"><strong>' + esc(node.id) + '</strong><span class="muted">' + esc(node.type) + '</span></div>').join('') || '<div class="muted">No nodes</div>';
  $('edges').innerHTML = message.state.edges.map((edge) => '<div class="edge">' + esc(edge.from) + ' → ' + esc(edge.to) + '</div>').join('') || '<div class="muted">No edges</div>';
  $('schema').value = JSON.stringify(message.state.stateSchema, null, 2);
  $('metadata').value = JSON.stringify(message.state.metadata, null, 2);
  $('node-capability').innerHTML = '<option value="">None</option>' + message.capabilities.map((item) => '<option value="' + esc(item.id) + '">' + esc(item.id) + '</option>').join('');
  $('node-resource').innerHTML = '<option value="">None</option>' + message.resources.map((item) => '<option value="' + esc(item.id) + '">' + esc(item.id) + '</option>').join('');
}
window.addEventListener('message', (event) => { const message = event.data; if (message.type === 'state') { $('error').textContent = ''; render(message); } if (message.type === 'error') $('error').textContent = message.message; });
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

type EditorMessage =
  | { readonly type: "ready" }
  | { readonly type: "addNode"; readonly options: { readonly id: string; readonly type: string; readonly capabilityId?: string; readonly resourceReferences?: readonly { readonly resourceId: string }[] } }
  | { readonly type: "updateNode"; readonly options: never }
  | { readonly type: "removeNode"; readonly nodeId: string }
  | { readonly type: "addEdge"; readonly from: string; readonly to: string; readonly label?: string }
  | { readonly type: "removeEdge"; readonly from: string; readonly to: string }
  | { readonly type: "updateSchema"; readonly schema: { readonly name: string; readonly version?: number; readonly fields?: Record<string, { readonly type: "string" | "number" | "boolean" | "object" | "array" | "any" | "null"; readonly required?: boolean; readonly items?: "string" | "number" | "boolean" | "object" | "array" | "any" | "null" }> } }
  | { readonly type: "updateMetadata"; readonly metadata: Readonly<Record<string, unknown>> }
  | { readonly type: "undo" | "redo" | "save" | "validate" | "publish" };

type EditorResponse =
  | { readonly type: "state"; readonly state: EditorSnapshot; readonly lifecycle: string; readonly pipelineId: string; readonly capabilities: readonly unknown[]; readonly resources: readonly unknown[] }
  | { readonly type: "error"; readonly message: string };

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}