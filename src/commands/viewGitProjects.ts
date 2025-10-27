import * as vscode from 'vscode';
import { getWebviewContent } from '../webview/getWebviewContent';

let currentPanel: vscode.WebviewPanel | undefined = undefined;

export function registerViewGitProjectsCommand(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('sprintdesk.viewGitProjects', async () => {
        try {
            const projects = await vscode.commands.executeCommand('sprintdesk.scanGitProjects');
            
            if (currentPanel) {
                currentPanel.webview.postMessage({
                    type: 'SET_GIT_PROJECTS',
                    projects
                });
            } else {
                // Create a new panel
                currentPanel = vscode.window.createWebviewPanel(
                    'sprintdesk.gitProjects',
                    'Git Projects',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true
                    }
                );

                // Reset when the panel is disposed
                currentPanel.onDidDispose(() => {
                    currentPanel = undefined;
                }, null, context.subscriptions);

                currentPanel.webview.html = getWebviewContent(context, currentPanel.webview);
                currentPanel.webview.postMessage({
                    type: 'SET_GIT_PROJECTS',
                    projects
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to scan git projects');
            console.error(error);
        }
    });

    context.subscriptions.push(disposable);
}