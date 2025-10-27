import * as vscode from 'vscode';
import { getWebviewContent } from '../webview/getWebviewContent';

interface ProjectItem {
    name: string;
    lastCommit: string;
    lastUpdate: string;
}

interface ProjectStructure {
    name: string;
    path: string;
    lastCommit: string;
    lastUpdate: string;
    backlogs: ProjectItem[];
    epics: ProjectItem[];
    sprints: ProjectItem[];
    tasks: ProjectItem[];
}

interface ProjectData {
    parentProject: {
        name: string;
        path: string;
        lastCommit: string;
        lastUpdate: string;
    };
    subProjects: ProjectStructure[];
}

let currentPanel: vscode.WebviewPanel | undefined = undefined;

export function registerViewProjectStructureCommand(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('sprintdesk.viewProjectStructure', async () => {
        try {
            const structure = await vscode.commands.executeCommand('sprintdesk.scanProjectStructure') as ProjectData;
            
            if (!currentPanel) {
                currentPanel = vscode.window.createWebviewPanel(
                    'sprintdesk.projectStructure',
                    'Project Structure',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true
                    }
                );

                currentPanel.onDidDispose(() => {
                    currentPanel = undefined;
                }, null, context.subscriptions);

                currentPanel.webview.html = getWebviewContent(context, currentPanel.webview);
            }

            if (structure) {
                currentPanel.webview.postMessage({
                    type: 'SET_PROJECT_STRUCTURE',
                    parentProject: structure.parentProject,
                    subProjects: structure.subProjects
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to scan project structure');
            console.error(error);
        }
    });

    context.subscriptions.push(disposable);
}