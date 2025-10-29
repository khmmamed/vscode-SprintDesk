import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ProjectItem {
    name: string;
    lastCommit: string;
    lastUpdate: string;
}

export interface ProjectStructure {
    name: string;
    path: string;
    lastCommit: string;
    lastUpdate: string;
    backlogs: ProjectItem[];
    epics: ProjectItem[];
    sprints: ProjectItem[];
    tasks: ProjectItem[];
}

export async function findSubProjects(rootPath: string): Promise<ProjectStructure[]> {
    const projects: ProjectStructure[] = [];
    try {
        const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const projectPath = path.join(rootPath, entry.name);
                const sprintDeskPath = path.join(projectPath, '.SprintDesk');
                
                if (fs.existsSync(sprintDeskPath)) {
                    const structure = await analyzeProjectStructure(projectPath);
                    if (structure) {
                        projects.push(structure);
                    }
                }
                
                // Recursively scan subdirectories
                const subProjects = await findSubProjects(projectPath);
                projects.push(...subProjects);
            }
        }
    } catch (error) {
        console.error('Error scanning for sub-projects:', error);
    }
    
    return projects;
}

export async function analyzeProjectStructure(projectPath: string): Promise<ProjectStructure> {
    const sprintDeskPath = path.join(projectPath, '.SprintDesk');
    const structure: ProjectStructure = {
        name: path.basename(projectPath),
        path: projectPath,
        lastCommit: 'Initial',
        lastUpdate: new Date().toLocaleDateString(),
        backlogs: [],
        epics: [],
        sprints: [],
        tasks: []
    };

    try {
        // Analyze backlogs
        const backlogsPath = path.join(sprintDeskPath, 'Backlogs');
        if (fs.existsSync(backlogsPath)) {
            structure.backlogs = await getItems(backlogsPath);
        }

        // Analyze epics
        const epicsPath = path.join(sprintDeskPath, 'Epics');
        if (fs.existsSync(epicsPath)) {
            structure.epics = await getItems(epicsPath);
        }

        // Analyze sprints
        const sprintsPath = path.join(sprintDeskPath, 'Sprints');
        if (fs.existsSync(sprintsPath)) {
            structure.sprints = await getItems(sprintsPath);
        }

        // Analyze tasks
        const tasksPath = path.join(sprintDeskPath, 'Tasks');
        if (fs.existsSync(tasksPath)) {
            structure.tasks = await getItems(tasksPath);
        }
    } catch (error) {
        console.error('Error analyzing project structure:', error);
    }

    return structure;
}

async function getItems(directoryPath: string): Promise<ProjectItem[]> {
    const items: ProjectItem[] = [];
    try {
        const files = await fs.promises.readdir(directoryPath);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const stats = await fs.promises.stat(path.join(directoryPath, file));
                items.push({
                    name: file.replace(/\.md$/, ''),
                    lastCommit: 'Initial',
                    lastUpdate: stats.mtime.toLocaleDateString()
                });
            }
        }
    } catch (error) {
        console.error('Error getting items:', error);
    }
    return items;
}