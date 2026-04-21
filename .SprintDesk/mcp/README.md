# SprintDesk MCP Server

Local MCP server for integrating SprintDesk with AI agents like Copilot, Claude, etc.

## Overview

This MCP exposes all SprintDesk task management operations to AI agents through JSON-RPC 2.0 protocol. AI agents can use these tools to perform CRUD operations on tasks, epics, sprints, and backlogs.

## Available Tools

### Task Tools
| Tool | Description |
|------|-------------|
| `sprintdesk_createTask` | Create a new task |
| `sprintdesk_getTask` | Get task by ID or code |
| `sprintdesk_updateTask` | Update task fields |
| `sprintdesk_deleteTask` | Delete a task |
| `sprintdesk_listTasks` | List all tasks (with optional status filter) |
| `sprintdesk_searchTasks` | Search tasks by title |

### Epic Tools
| Tool | Description |
|------|-------------|
| `sprintdesk_createEpic` | Create a new epic |
| `sprintdesk_getEpic` | Get epic by ID or code |
| `sprintdesk_updateEpic` | Update epic fields |
| `sprintdesk_deleteEpic` | Delete an epic |
| `sprintdesk_listEpics` | List all epics |
| `sprintdesk_getTasksByEpic` | Get all tasks in an epic |
| `sprintdesk_addTaskToEpic` | Add task to an epic |

### Sprint Tools
| Tool | Description |
|------|-------------|
| `sprintdesk_createSprint` | Create a new sprint |
| `sprintdesk_getSprint` | Get sprint by ID or number |
| `sprintdesk_updateSprint` | Update sprint fields |
| `sprintdesk_deleteSprint` | Delete a sprint |
| `sprintdesk_listSprints` | List all sprints |
| `sprintdesk_getTasksBySprint` | Get all tasks in a sprint |
| `sprintdesk_addTaskToSprint` | Add task to a sprint |

### Backlog Tools
| Tool | Description |
|------|-------------|
| `sprintdesk_createBacklog` | Create a new backlog |
| `sprintdesk_getBacklog` | Get backlog by ID or name |
| `sprintdesk_listBacklogs` | List all backlogs |
| `sprintdesk_addTaskToBacklog` | Add task to a backlog |

### Move Tools
| Tool | Description |
|------|-------------|
| `sprintdesk_moveTaskToEpic` | Move task to epic (auto-renames task code) |
| `sprintdesk_moveTaskToSprint` | Move task to sprint |
| `sprintdesk_moveTaskToBacklog` | Move task to backlog |

## Example AI Prompts

### Create a task
```
"Create a new task 'Implement login form' in the SPD-101 epic"
```

### Get tasks by epic
```
"Show me all tasks in the SPD-101 epic"
```

### Move a task
```
"Move task SPD-101.2 to epic SPD-102"
```

### Update task status
```
"Mark task SPD-101.1 as done"
```

### List all in-progress tasks
```
"Show me all in-progress tasks"
```

## JSON-RPC API

### Initialize
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {}
}
```

### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/list",
  "params": {}
}
```

### Call Tool
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "sprintdesk_listTasks",
    "arguments": {}
  }
}
```

## Response Format
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"id\": \"...\", ...}]"
      }
    ]
  }
}
```

## Integration with AI Agents

The MCP server is automatically available when this VS Code extension is active. AI agents using MCP protocol can discover and use these tools through the extension's MCP capabilities.