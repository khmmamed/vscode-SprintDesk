import * as fileService from '../services/fileService';
import * as taskService from '../services/taskService';
import * as epicService from '../services/epicService';
import * as sprintService from '../services/sprintService';
import * as backlogService from '../services/backlogService';
import * as teamService from '../services/team/teamService';
import * as historyService from '../services/history/historyService';
import { getDataService } from '../data/DataService';
import { Task } from '../data/types';

interface HandlerResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function res(text: string, isError = false): HandlerResult {
  return { content: [{ type: 'text', text }], isError };
}

function getWs(): string | undefined {
  return fileService.getWorkspaceRoot();
}

function getDs() {
  const ws = getWs();
  return ws ? getDataService(ws) : undefined;
}

async function handle_sprintdesk_createTask(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const result = await taskService.createTask(ws, {
      title: args.title,
      type: args.type || 'feature',
      priority: args.priority || 'medium',
      epic: args.epicCode || null,
      backlog: args.backlogName
    });
    
    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  
  if (!task) return res(`Task not found: ${taskId}`, true);
  return res(JSON.stringify(task, null, 2));
}

async function handle_sprintdesk_updateTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const updates: any = {};
  if (args.title) updates.title = args.title;
  if (args.status) updates.status = args.status;
  if (args.priority) updates.priority = args.priority;
  if (args.type) updates.type = args.type;
  
  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }
  
  ds.updateTask(task.id, updates);
  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);
  
  return res(JSON.stringify(updatedTask, null, 2));
}

async function handle_sprintdesk_deleteTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  ds.deleteTask(task.id);
  
  return res(`Task deleted: ${task.code}`);
}

async function handle_sprintdesk_listTasks(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  let tasks = ds.loadTasks();
  
  if (args.status) {
    tasks = tasks.filter(t => t.status === args.status);
  }
  
  if (args.limit) {
    tasks = tasks.slice(0, args.limit);
  }
  
  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_searchTasks(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const query = args.query.toLowerCase();
  const tasks = ds.loadTasks().filter(t => 
    t.title.toLowerCase().includes(query) ||
    t.code.toLowerCase().includes(query)
  );
  
  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_createEpic(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const result = await epicService.createNewEpic({
      title: args.title,
      category: args.category || 'MISC',
      priority: args.priority || 'medium'
    });
    
    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const epicId = args.epicId;
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  return res(JSON.stringify(epic, null, 2));
}

async function handle_sprintdesk_updateEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const epicId = args.epicId;
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  
  const updates: any = {};
  if (args.title) updates.title = args.title;
  if (args.status) updates.status = args.status;
  if (args.priority) updates.priority = args.priority;
  if (args.category) updates.category = args.category;
  
  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }
  
  ds.updateEpic(epic.id, updates);
  const updatedEpic = ds.getEpic(epic.id);
  if (updatedEpic) ds.saveEpicMd(updatedEpic);
  
  return res(JSON.stringify(updatedEpic, null, 2));
}

async function handle_sprintdesk_deleteEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const epicId = args.epicId;
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  
  ds.deleteEpic(epic.id);
  
  return res(`Epic deleted: ${epic.code}`);
}

async function handle_sprintdesk_listEpics(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  let epics = ds.loadEpics();
  
  if (args.status) {
    epics = epics.filter(e => e.status === args.status);
  }
  
  return res(JSON.stringify(epics, null, 2));
}

async function handle_sprintdesk_getTasksByEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const epicId = args.epicId;
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  
  const tasks = ds.loadTasks().filter(t => epic.tasks.includes(t.id));
  
  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_addTaskToEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const epicId = args.epicId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  
  epicService.addTaskToEpicById(epic.id, task.id);
  
  return res(`Task ${task.code} added to epic ${epic.code}`);
}

async function handle_sprintdesk_createSprint(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const dateParts = args.startDate.split('-');
    const d1 = dateParts[2];
    const mo1 = dateParts[1];
    const d2 = args.endDate.split('-')[2];
    const mo2 = args.endDate.split('-')[1];
    const yy = dateParts[0].slice(-2);
    const yyyy = dateParts[0];
    
    const name = `${args.name}_${mo1}-${d1}-${yyyy}_${mo2}-${d2}-${yy}`;
    const result = sprintService.createSprint({ d1, mo1, d2, mo2, yy, yyyy, title: args.name });
    
    return res(`Sprint created: ${result}`);
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const sprintId = args.sprintId;
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  return res(JSON.stringify(sprint, null, 2));
}

async function handle_sprintdesk_updateSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const sprintId = args.sprintId;
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  
  const updates: any = {};
  if (args.name) updates.name = args.name;
  if (args.startDate) updates.startDate = args.startDate;
  if (args.endDate) updates.endDate = args.endDate;
  if (args.status) updates.status = args.status;
  
  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }
  
  ds.updateSprint(sprint.id, updates);
  const updatedSprint = ds.getSprint(sprint.id);
  if (updatedSprint) ds.saveSprintMd(updatedSprint);
  
  return res(JSON.stringify(updatedSprint, null, 2));
}

async function handle_sprintdesk_deleteSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const sprintId = args.sprintId;
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  
  ds.deleteSprint(sprint.id);
  
  return res(`Sprint deleted: ${sprint.name}`);
}

async function handle_sprintdesk_listSprints(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  let sprints = ds.loadSprints();
  
  if (args.status) {
    sprints = sprints.filter(s => s.status === args.status);
  }
  
  return res(JSON.stringify(sprints, null, 2));
}

async function handle_sprintdesk_getTasksBySprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const sprintId = args.sprintId;
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  
  const tasks = ds.loadTasks().filter(t => sprint.tasks.includes(t.id));
  
  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_addTaskToSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const sprintId = args.sprintId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  
  sprintService.addTaskToSprintById(sprint.id, task.id);
  
  return res(`Task ${task.code} added to sprint ${sprint.name}`);
}

async function handle_sprintdesk_createBacklog(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const backlog = {
    id: `backlog_${Date.now()}`,
    title: args.name,
    name: args.name,
    description: args.description || '',
    tasks: [] as string[],
    color: '#3b82f6'
  };
  
  ds.saveBacklogMd(backlog);
  
  return res(`Backlog created: ${backlog.name}`);
}

async function handle_sprintdesk_getBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const backlogId = args.backlogId;
  const backlog = ds.getBacklog(backlogId) || ds.loadBacklogs().find(b => b.name === backlogId || b.title === backlogId);
  
  if (!backlog) return res(`Backlog not found: ${backlogId}`, true);
  return res(JSON.stringify(backlog, null, 2));
}

async function handle_sprintdesk_listBacklogs(_args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const backlogs = ds.loadBacklogs();
  
  return res(JSON.stringify(backlogs, null, 2));
}

async function handle_sprintdesk_addTaskToBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const backlogId = args.backlogId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const backlog = ds.getBacklog(backlogId) || ds.loadBacklogs().find(b => b.name === backlogId || b.title === backlogId);
  if (!backlog) return res(`Backlog not found: ${backlogId}`, true);
  
  backlogService.addTaskToBacklogById(backlog.id, task.id);
  
  return res(`Task ${task.code} added to backlog ${backlog.name}`);
}

async function handle_sprintdesk_moveTaskToEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const epicId = args.epicId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const epic = ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
  if (!epic) return res(`Epic not found: ${epicId}`, true);
  
  const oldEpicId = task.epic;
  if (oldEpicId) {
    const oldEpic = ds.loadEpics().find(e => e.name === oldEpicId || e.id === oldEpicId);
    if (oldEpic) epicService.removeTaskFromEpicById(oldEpic.id, task.id);
  }
  
  epicService.addTaskToEpicById(epic.id, task.id);
  
  const updatedTask = ds.getTask(task.id);
  
  return res(`Task ${updatedTask?.code} moved to epic ${epic.code}`);
}

async function handle_sprintdesk_moveTaskToSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const sprintId = args.sprintId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const sprint = ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
  if (!sprint) return res(`Sprint not found: ${sprintId}`, true);
  
  const oldSprintId = task.sprint;
  if (oldSprintId) {
    sprintService.removeTaskFromSprintById(oldSprintId, task.id);
  }
  
  sprintService.addTaskToSprintById(sprint.id, task.id);
  
  return res(`Task ${task.code} moved to sprint ${sprint.name}`);
}

async function handle_sprintdesk_moveTaskToBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);
  
  const taskId = args.taskId;
  const backlogId = args.backlogId;
  
  const task = ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
  if (!task) return res(`Task not found: ${taskId}`, true);
  
  const backlog = ds.getBacklog(backlogId) || ds.loadBacklogs().find(b => b.name === backlogId || b.title === backlogId);
  if (!backlog) return res(`Backlog not found: ${backlogId}`, true);
  
  const oldBacklogId = task.backlog;
  if (oldBacklogId) {
    backlogService.removeTaskFromBacklogById(oldBacklogId, task.id);
  }
  
  backlogService.addTaskToBacklogById(backlog.id, task.id);
  
  return res(`Task ${task.code} moved to backlog ${backlog.name}`);
}

// Team handlers
async function handle_sprintdesk_listTeam(_args: any): Promise<HandlerResult> {
  const members = teamService.loadTeamMembers();
  return res(JSON.stringify(members, null, 2));
}

async function handle_sprintdesk_syncTeamFromGit(_args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const members = await teamService.syncTeamFromGit();
    return res(`Team synced: ${members.length} members found`);
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_addTeamMember(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const member = teamService.addTeamMember({
      name: args.name,
      email: args.email,
      role: args.role || 'developer',
      avatar: args.avatar,
      agentConfig: args.agentConfig
    });
    return res(JSON.stringify(member, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_removeTeamMember(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  const removed = teamService.removeTeamMember(args.id || args.email);
  if (removed) {
    return res('Team member removed');
  }
  return res('Team member not found', true);
}

async function handle_sprintdesk_runAgent(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  const agentId = args.agentId;
  const taskCode = args.taskCode;
  
  if (!agentId || !taskCode) {
    return res('agentId and taskCode required', true);
  }
  
  try {
    const { runAgent } = require('../services/agentRunner');
    const { getDataService } = require('../data/DataService');
    const dataService = getDataService(ws);
    const task = dataService.getTask(taskCode) || dataService.loadTasks().find((t: Task) => t.code === taskCode);
    
    if (!task) {
      return res(`Task ${taskCode} not found`, true);
    }
    
    const agent = teamService.getAgent(agentId);
    if (!agent) {
      return res(`Agent ${agentId} not found`, true);
    }
    
    const result = await runAgent(agent, task);
    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getHistory(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  const itemId = args.itemId;
  const itemType = args.itemType;
  const limit = args.limit || 50;
  
  if (itemId && itemType) {
    const history = historyService.getHistoryForItem(itemId, itemType, limit);
    return res(JSON.stringify(history, null, 2));
  }
  
  const allHistory = historyService.getAllHistory(limit);
  return res(JSON.stringify(allHistory, null, 2));
}

async function handle_sprintdesk_trackChange(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);
  
  try {
    const entry = historyService.trackChange(
      args.itemId,
      args.itemType,
      args.action,
      args.field,
      args.oldValue,
      args.newValue
    );
    return res(JSON.stringify(entry, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

export const HANDLERS: Record<string, (args: any) => Promise<HandlerResult>> = {
  sprintdesk_createTask: handle_sprintdesk_createTask,
  sprintdesk_getTask: handle_sprintdesk_getTask,
  sprintdesk_updateTask: handle_sprintdesk_updateTask,
  sprintdesk_deleteTask: handle_sprintdesk_deleteTask,
  sprintdesk_listTasks: handle_sprintdesk_listTasks,
  sprintdesk_searchTasks: handle_sprintdesk_searchTasks,
  sprintdesk_createEpic: handle_sprintdesk_createEpic,
  sprintdesk_getEpic: handle_sprintdesk_getEpic,
  sprintdesk_updateEpic: handle_sprintdesk_updateEpic,
  sprintdesk_deleteEpic: handle_sprintdesk_deleteEpic,
  sprintdesk_listEpics: handle_sprintdesk_listEpics,
  sprintdesk_getTasksByEpic: handle_sprintdesk_getTasksByEpic,
  sprintdesk_addTaskToEpic: handle_sprintdesk_addTaskToEpic,
  sprintdesk_createSprint: handle_sprintdesk_createSprint,
  sprintdesk_getSprint: handle_sprintdesk_getSprint,
  sprintdesk_updateSprint: handle_sprintdesk_updateSprint,
  sprintdesk_deleteSprint: handle_sprintdesk_deleteSprint,
  sprintdesk_listSprints: handle_sprintdesk_listSprints,
  sprintdesk_getTasksBySprint: handle_sprintdesk_getTasksBySprint,
  sprintdesk_addTaskToSprint: handle_sprintdesk_addTaskToSprint,
  sprintdesk_createBacklog: handle_sprintdesk_createBacklog,
  sprintdesk_getBacklog: handle_sprintdesk_getBacklog,
  sprintdesk_listBacklogs: handle_sprintdesk_listBacklogs,
  sprintdesk_addTaskToBacklog: handle_sprintdesk_addTaskToBacklog,
sprintdesk_moveTaskToEpic: handle_sprintdesk_moveTaskToEpic,
  sprintdesk_moveTaskToSprint: handle_sprintdesk_moveTaskToSprint,
  sprintdesk_moveTaskToBacklog: handle_sprintdesk_moveTaskToBacklog,
  sprintdesk_listTeam: handle_sprintdesk_listTeam,
  sprintdesk_syncTeamFromGit: handle_sprintdesk_syncTeamFromGit,
  sprintdesk_addTeamMember: handle_sprintdesk_addTeamMember,
  sprintdesk_removeTeamMember: handle_sprintdesk_removeTeamMember,
  sprintdesk_runAgent: handle_sprintdesk_runAgent,
  sprintdesk_getHistory: handle_sprintdesk_getHistory,
  sprintdesk_trackChange: handle_sprintdesk_trackChange,
};

export async function handleToolCall(toolName: string, args: any): Promise<HandlerResult> {
  const handler = HANDLERS[toolName];
  if (!handler) {
    return res(`Unknown tool: ${toolName}`, true);
  }
  return handler(args);
}

export const ALL_TOOLS = Object.keys(HANDLERS).map(name => ({
  name,
  description: `SprintDesk ${name.replace('sprintdesk_', '')} operation`
}));