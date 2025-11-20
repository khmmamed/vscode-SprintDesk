import * as vscode from 'vscode';
import { scanProjectStructure } from './scanProjectStructure';

export function registerScanProjectStructureCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.scanProjectStructure', async () => {
      const structure = await scanProjectStructure();
      return structure;
    })
  );
}
