import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function scanGitProjects() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showInformationMessage('No workspace folders found');
        return;
    }

    let gitProjects: Array<{
        name: string;
        path: string;
        hasSprintDesk: boolean;
        lastCommit: string;
        lastUpdate: string;
    }> = [];

    for (const folder of workspaceFolders) {
        const projects = await findGitProjects(folder.uri.fsPath);
        gitProjects = [...gitProjects, ...projects];
    }

    return gitProjects;
}

async function findGitProjects(rootPath: string): Promise<Array<{
    name: string;
    path: string;
    hasSprintDesk: boolean;
    lastCommit: string;
    lastUpdate: string;
}>> {
    const projects: Array<{
        name: string;
        path: string;
        hasSprintDesk: boolean;
        lastCommit: string;
        lastUpdate: string;
    }> = [];

    try {
        const items = await fs.promises.readdir(rootPath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isDirectory()) {
                const fullPath = path.join(rootPath, item.name);
                
                // Check if directory has .git folder
                const hasGit = fs.existsSync(path.join(fullPath, '.git'));
                
                if (hasGit) {
                    // Check for .SprintDesk folder
                    const hasSprintDesk = fs.existsSync(path.join(fullPath, '.SprintDesk'));
                    
                    // Get last commit info using git command
                    let lastCommit = '';
                    let lastUpdate = '';
                    
                    try {
                        const gitLog = await vscode.workspace.fs.readFile(
                            vscode.Uri.file(path.join(fullPath, '.git', 'logs', 'HEAD'))
                        );
                        const logs = Buffer.from(gitLog).toString().split('\n');
                        if (logs.length > 0) {
                            const lastLog = logs[logs.length - 2]; // -2 because last line is empty
                            const match = lastLog.match(/[0-9]+\s+[+-][0-9]{4}/);
                            if (match) {
                                const timestamp = parseInt(match[0].split(' ')[0]);
                                lastUpdate = new Date(timestamp * 1000).toLocaleDateString();
                                lastCommit = lastLog.split(' ').slice(-1)[0];
                            }
                        }
                    } catch (error) {
                        lastCommit = 'No commits';
                        lastUpdate = 'Never';
                    }

                    projects.push({
                        name: item.name,
                        path: fullPath,
                        hasSprintDesk,
                        lastCommit,
                        lastUpdate
                    });
                } else {
                    // Recursively search in subdirectories
                    const subProjects = await findGitProjects(fullPath);
                    projects.push(...subProjects);
                }
            }
        }
    } catch (error) {
        console.error('Error scanning directory:', error);
    }

    return projects;
}