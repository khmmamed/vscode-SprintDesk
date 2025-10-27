import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

export async function scanProjectStructure() {
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
}

async function findSubProjects(rootPath: string): Promise<ProjectStructure[]> {
    const projects: ProjectStructure[] = [];

    try {
        const items = await fs.promises.readdir(rootPath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isDirectory()) {
                const fullPath = path.join(rootPath, item.name);
                
                // Check if directory has .SprintDesk folder
                const hasSprintDesk = fs.existsSync(path.join(fullPath, '.SprintDesk'));
                
                if (hasSprintDesk) {
                    // Get project structure
                    const sprintDeskPath = path.join(fullPath, '.SprintDesk');
                    const project: ProjectStructure = {
                        name: item.name,
                        path: fullPath,
                        lastCommit: '',
                        lastUpdate: new Date().toLocaleDateString(),
                        backlogs: [],
                        epics: [],
                        sprints: [],
                        tasks: []
                    };

                    // Read each category
                    const categories = ['Backlogs', 'Epics', 'Sprints', 'Tasks'];
                    for (const category of categories) {
                        const categoryPath = path.join(sprintDeskPath, category);
                        if (fs.existsSync(categoryPath)) {
                            const files = await fs.promises.readdir(categoryPath);
                            const categoryItems = files.map(file => ({
                                name: file,
                                lastCommit: '',
                                lastUpdate: new Date().toLocaleDateString()
                            }));
                            
                            switch(category.toLowerCase()) {
                                case 'backlogs':
                                    project.backlogs = categoryItems;
                                    break;
                                case 'epics':
                                    project.epics = categoryItems;
                                    break;
                                case 'sprints':
                                    project.sprints = categoryItems;
                                    break;
                                case 'tasks':
                                    project.tasks = categoryItems;
                                    break;
                            }
                        }
                    }

                    projects.push(project);
                }
            }
        }
    } catch (error) {
        console.error('Error scanning directory:', error);
    }

    return projects;
}