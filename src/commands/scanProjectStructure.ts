import * as vscode from 'vscode';
import * as path from 'path';

export async function scanForSprintDeskFolders() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return [];
    }

    const sprintDeskFolders = [];
    
    for (const folder of workspaceFolders) {
        try {
            const pattern = new vscode.RelativePattern(folder, '**/.SprintDesk');
            const files = await vscode.workspace.findFiles(pattern);
            
            for (const file of files) {
                const projectPath = path.dirname(file.fsPath);
                const projectName = path.basename(path.dirname(file.fsPath));
                
                sprintDeskFolders.push({
                    name: projectName,
                    path: projectPath,
                    sprintDeskPath: file.fsPath,
                    lastUpdate: new Date().toLocaleDateString()
                });
            }
        } catch (error) {
            console.error(`Error scanning workspace folder ${folder.name}:`, error);
        }
    }

    return sprintDeskFolders;
}

export async function scanProjectStructure() {
    const projects = await scanForSprintDeskFolders();
    
    if (projects.length === 0) {
        vscode.window.showInformationMessage('No .SprintDesk folders found in the workspace.');
        return [];
    }

    return {
        parentProject: projects[0],
        subProjects: projects.slice(1)
    };
}