import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { TeamMember, TeamData, AgentRole } from '../../data/types';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { getHost, getFileSystem } from '../../host';

const TEAM_FILE = 'team.yml';

function getTeamPath(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.DATA_DIR, TEAM_FILE);
}

function loadTeamFromFile(ws: string): TeamMember[] {
  const teamPath = getTeamPath(ws);
  try {
    const fileSystem = getFileSystem();
    if (!fileSystem.exists(teamPath)) return [];
    const content = fileSystem.readFile(teamPath);
    const data = yaml.load(content) as TeamData;
    return data?.members || [];
  } catch {
    return [];
  }
}

function saveTeamToFile(ws: string, members: TeamMember[]): void {
  const teamPath = getTeamPath(ws);
  const fileSystem = getFileSystem();
  fileSystem.mkdir(path.dirname(teamPath), { recursive: true });
  fileSystem.writeFile(teamPath, yaml.dump({ members }));
}

export async function syncTeamFromGit(): Promise<TeamMember[]> {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace found');

  try {
    const host = getHost();
    const { stdout } = await host.exec('git log --format="%ae|%an" --all', { cwd: ws });

    const authors = new Map<string, string>();
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [email, name] = line.split('|');
      if (email && name && !authors.has(email)) {
        authors.set(email, name);
      }
    }

    const existingMembers = loadTeamFromFile(ws);
    const existingEmails = new Set(existingMembers.map(m => m.email));
    const newAuthors = Array.from(authors.entries()).filter(([email]) => !existingEmails.has(email));

    for (const [email, name] of newAuthors) {
      existingMembers.push({
        id: crypto.randomUUID(),
        name,
        email,
        role: 'developer',
        gitAuthor: name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    saveTeamToFile(ws, existingMembers);
    return existingMembers;
  } catch {
    getHost().showMessage('Git not available or no commits yet', 'warning');
    return [];
  }
}

export function getCurrentGitUser(): { name: string; email: string } | null {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return null;

  try {
    const host = getHost();
    const name = host.execSync('git config user.name', { cwd: ws }).stdout.trim();
    const email = host.execSync('git config user.email', { cwd: ws }).stdout.trim();
    return { name, email };
  } catch {
    return null;
  }
}

export function loadTeamMembers(): TeamMember[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];
  return loadTeamFromFile(ws);
}

export function getTeamMember(id: string): TeamMember | undefined {
  const members = loadTeamMembers();
  return members.find(m => m.id === id || m.email === id);
}

export function addTeamMember(member: Omit<TeamMember, 'id' | 'createdAt' | 'updatedAt'>): TeamMember {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace found');

  const members = loadTeamFromFile(ws);

  const existing = members.find(m => m.email === member.email);
  if (existing) {
    Object.assign(existing, member, { updatedAt: new Date().toISOString() });
    saveTeamToFile(ws, members);
    return existing;
  }

  const newMember: TeamMember = {
    id: crypto.randomUUID(),
    ...member,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  members.push(newMember);
  saveTeamToFile(ws, members);
  return newMember;
}

export function updateTeamMember(id: string, updates: Partial<TeamMember>): TeamMember | undefined {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace found');

  const members = loadTeamFromFile(ws);
  const member = members.find(m => m.id === id || m.email === id);
  if (!member) return undefined;

  Object.assign(member, updates, { updatedAt: new Date().toISOString() });
  saveTeamToFile(ws, members);
  return member;
}

export function removeTeamMember(id: string): boolean {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return false;

  const members = loadTeamFromFile(ws);
  const index = members.findIndex(m => m.id === id || m.email === id);
  if (index === -1) return false;

  members.splice(index, 1);
  saveTeamToFile(ws, members);
  return true;
}

export function getTeamByRole(role: TeamMember['role']): TeamMember[] {
  const members = loadTeamMembers();
  return members.filter(m => m.role === role);
}

export function getAgents(): TeamMember[] {
  return getTeamByRole('agent');
}

export function getAgent(id: string): TeamMember | undefined {
  const agents = getAgents();
  return agents.find(a => a.id === id || a.name === id);
}

export function assignTaskToMember(taskId: string, memberId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  dataService.updateTask(taskId, { assignee: memberId });
  const task = dataService.getTask(taskId);
  if (task) dataService.saveTaskMd(task);
}

export function unassignTaskFromMember(taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  dataService.updateTask(taskId, { assignee: '' });
  const task = dataService.getTask(taskId);
  if (task) dataService.saveTaskMd(task);
}

const TEAMS_DIR = 'teams';

function getTeamsPath(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, TEAMS_DIR);
}

function getAgentRolePath(ws: string, agentName: string): string {
  return path.join(getTeamsPath(ws), `${agentName}.json`);
}

export function loadAgentRole(agentName: string): AgentRole | undefined {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return undefined;
  
  const rolePath = getAgentRolePath(ws, agentName);
  try {
    if (!fs.existsSync(rolePath)) return undefined;
    const content = fs.readFileSync(rolePath, 'utf8');
    return JSON.parse(content) as AgentRole;
  } catch {
    return undefined;
  }
}

export function saveAgentRole(role: AgentRole): boolean {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return false;
  
  const teamsPath = getTeamsPath(ws);
  if (!fs.existsSync(teamsPath)) {
    fs.mkdirSync(teamsPath, { recursive: true });
  }
  
  const rolePath = getAgentRolePath(ws, role.name);
  try {
    fs.writeFileSync(rolePath, JSON.stringify(role, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function getAllAgentRoles(): AgentRole[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];
  
  const teamsPath = getTeamsPath(ws);
  if (!fs.existsSync(teamsPath)) return [];
  
  const files = fs.readdirSync(teamsPath).filter(f => f.endsWith('.json'));
  const roles: AgentRole[] = [];
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(teamsPath, file), 'utf8');
      roles.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }
  
  return roles;
}