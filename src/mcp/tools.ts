export const TASK_TOOLS = [
  {
    name: 'sprintdesk_createTask',
    description: 'Create a new task in SprintDesk',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        type: { type: 'string', enum: ['feature', 'bug', 'chore', 'doc', 'test'], description: 'Task type' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority' },
        epicCode: { type: 'string', description: 'Epic code (e.g., SPD-101)' },
        backlogName: { type: 'string', description: 'Backlog name' },
      },
      required: ['title'],
    },
  },
  {
    name: 'sprintdesk_getTask',
    description: 'Get a task by ID or code',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code (e.g., SPD-101.1)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'sprintdesk_updateTask',
    description: 'Update a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        title: { type: 'string', description: 'New title' },
        status: { type: 'string', enum: ['waiting', 'in-progress', 'done', 'blocked', 'cancelled'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        type: { type: 'string', enum: ['feature', 'bug', 'chore', 'doc', 'test'] },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'sprintdesk_deleteTask',
    description: 'Delete a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'sprintdesk_listTasks',
    description: 'List all tasks',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['waiting', 'in-progress', 'done', 'blocked', 'cancelled'] },
        limit: { type: 'number', description: 'Max tasks to return' },
      },
    },
  },
  {
    name: 'sprintdesk_searchTasks',
    description: 'Search tasks by title or description',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
];

export const EPIC_TOOLS = [
  {
    name: 'sprintdesk_createEpic',
    description: 'Create a new epic',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Epic title' },
        category: { type: 'string', description: 'Epic category (e.g., SEO, FE, BE)' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'sprintdesk_getEpic',
    description: 'Get an epic by ID or code',
    inputSchema: {
      type: 'object' as const,
      properties: {
        epicId: { type: 'string', description: 'Epic ID or code (e.g., SPD-101)' },
      },
      required: ['epicId'],
    },
  },
  {
    name: 'sprintdesk_updateEpic',
    description: 'Update an epic',
    inputSchema: {
      type: 'object' as const,
      properties: {
        epicId: { type: 'string', description: 'Epic ID or code' },
        title: { type: 'string', description: 'New title' },
        status: { type: 'string', enum: ['planned', 'in-progress', 'completed', 'blocked'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        category: { type: 'string', description: 'New category' },
      },
      required: ['epicId'],
    },
  },
  {
    name: 'sprintdesk_deleteEpic',
    description: 'Delete an epic',
    inputSchema: {
      type: 'object' as const,
      properties: {
        epicId: { type: 'string', description: 'Epic ID or code' },
      },
      required: ['epicId'],
    },
  },
  {
    name: 'sprintdesk_listEpics',
    description: 'List all epics',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['planned', 'in-progress', 'completed', 'blocked'] },
      },
    },
  },
  {
    name: 'sprintdesk_getTasksByEpic',
    description: 'Get all tasks in an epic',
    inputSchema: {
      type: 'object' as const,
      properties: {
        epicId: { type: 'string', description: 'Epic ID or code' },
      },
      required: ['epicId'],
    },
  },
  {
    name: 'sprintdesk_addTaskToEpic',
    description: 'Add a task to an epic',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        epicId: { type: 'string', description: 'Epic ID or code' },
      },
      required: ['taskId', 'epicId'],
    },
  },
];

export const SPRINT_TOOLS = [
  {
    name: 'sprintdesk_createSprint',
    description: 'Create a new sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Sprint name' },
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['name', 'startDate', 'endDate'],
    },
  },
  {
    name: 'sprintdesk_getSprint',
    description: 'Get a sprint by ID or number',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprintId: { type: 'string', description: 'Sprint ID or number' },
      },
      required: ['sprintId'],
    },
  },
  {
    name: 'sprintdesk_updateSprint',
    description: 'Update a sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprintId: { type: 'string', description: 'Sprint ID or number' },
        name: { type: 'string', description: 'New name' },
        startDate: { type: 'string', description: 'New start date' },
        endDate: { type: 'string', description: 'New end date' },
        status: { type: 'string', enum: ['planned', 'in-progress', 'completed'] },
      },
      required: ['sprintId'],
    },
  },
  {
    name: 'sprintdesk_deleteSprint',
    description: 'Delete a sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprintId: { type: 'string', description: 'Sprint ID or number' },
      },
      required: ['sprintId'],
    },
  },
  {
    name: 'sprintdesk_listSprints',
    description: 'List all sprints',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['planned', 'in-progress', 'completed'] },
      },
    },
  },
  {
    name: 'sprintdesk_getTasksBySprint',
    description: 'Get all tasks in a sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprintId: { type: 'string', description: 'Sprint ID or number' },
      },
      required: ['sprintId'],
    },
  },
  {
    name: 'sprintdesk_addTaskToSprint',
    description: 'Add a task to a sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        sprintId: { type: 'string', description: 'Sprint ID or number' },
      },
      required: ['taskId', 'sprintId'],
    },
  },
];

export const BACKLOG_TOOLS = [
  {
    name: 'sprintdesk_createBacklog',
    description: 'Create a new backlog',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Backlog name' },
        description: { type: 'string', description: 'Backlog description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'sprintdesk_getBacklog',
    description: 'Get a backlog by ID or name',
    inputSchema: {
      type: 'object' as const,
      properties: {
        backlogId: { type: 'string', description: 'Backlog ID or name' },
      },
      required: ['backlogId'],
    },
  },
  {
    name: 'sprintdesk_listBacklogs',
    description: 'List all backlogs',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_addTaskToBacklog',
    description: 'Add a task to a backlog',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        backlogId: { type: 'string', description: 'Backlog ID or name' },
      },
      required: ['taskId', 'backlogId'],
    },
  },
];

export const MOVE_TOOLS = [
  {
    name: 'sprintdesk_moveTaskToEpic',
    description: 'Move a task to a different epic (will update task code)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        epicId: { type: 'string', description: 'Target Epic ID or code' },
      },
      required: ['taskId', 'epicId'],
    },
  },
  {
    name: 'sprintdesk_moveTaskToSprint',
    description: 'Move a task to a different sprint',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        sprintId: { type: 'string', description: 'Target Sprint ID or number' },
      },
      required: ['taskId', 'sprintId'],
    },
  },
  {
    name: 'sprintdesk_moveTaskToBacklog',
    description: 'Move a task to a different backlog',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID or code' },
        backlogId: { type: 'string', description: 'Target Backlog ID or name' },
      },
      required: ['taskId', 'backlogId'],
    },
  },
];

export const ALL_TOOLS = [
  ...TASK_TOOLS,
  ...EPIC_TOOLS,
  ...SPRINT_TOOLS,
  ...BACKLOG_TOOLS,
  ...MOVE_TOOLS,
];

export function getToolByName(name: string) {
  return ALL_TOOLS.find(t => t.name === name);
}

export function getAllToolNames(): string[] {
  return ALL_TOOLS.map(t => t.name);
}