import * as vscode from 'vscode';
import { findSubProjects } from '../utils/projectUtils';

export function registerScanProjectStructureCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('sprintdesk.scanProjectStructure', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('No workspace folders found');
            return;
        }

        // Get the root workspace folder
        const rootFolder = workspaceFolders[0];
        const parentProject = {
            name: rootFolder.name,
            path: rootFolder.uri.fsPath,
            lastCommit: 'Initial',
            lastUpdate: new Date().toLocaleDateString()
        };

        // Scan for sub-projects (folders with .SprintDesk)
        const subProjects = await findSubProjects(rootFolder.uri.fsPath);

        return {
            parentProject,
            subProjects
        };
    });

    context.subscriptions.push(disposable);
}