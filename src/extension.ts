import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("📦 SprintDesk (Clean Version) ready!");
}

export function deactivate() { }
