

export const AGENT_TOOLS = [
  {
    name: 'sprintdesk_agentsList',
    description: 'List available agents (from people/agents.yml)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_agentsGet',
    description: 'Get a single agent by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
      },
      required: ['agentId'],
    },
  },
];

export const RUN_TOOLS = [
  {
    name: 'sprintdesk_runsCreate',
    description: 'Create a new run record for a plan (queued; no autonomous execution)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID or code' },
        agentId: { type: 'string', description: 'Optional agent to assign' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'sprintdesk_runsList',
    description: 'List run records, optionally filtered by planId or status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID to filter by' },
        status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
        limit: { type: 'number', description: 'Max runs to return' },
      },
    },
  },
  {
    name: 'sprintdesk_runsGet',
    description: 'Get a run record by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'Run ID' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'sprintdesk_runsCancel',
    description: 'Cancel a queued or running run (delegates transition to the queue service)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        actorId: { type: 'string', description: 'Employee id/name performing the cancellation (requires run:cancel)' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'sprintdesk_runsUpdate',
    description: 'Report worker completion for a running run (completed|failed; delegates final transition to the queue service)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        status: { type: 'string', enum: ['completed', 'failed'] },
        result: { type: 'string', description: 'Completion result summary' },
        error: { type: 'string', description: 'Error detail when failed' },
        actorId: { type: 'string', description: 'Caller/worker employee id or name (defaults to run.agentId)' },
      },
      required: ['runId', 'status'],
    },
  },
];

export const QUEUE_TOOLS = [
  {
    name: 'sprintdesk_queueGet',
    description: 'Read-only snapshot of the workforce queue: settings, capacity, queued/running runs, next claims and skip reasons for the next pass',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_queueProcess',
    description: 'Run one synchronous queue pass: claim + start eligible queued runs, then execute each via the worker boundary (headless/terminal/noop). No implicit auto-assignment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Optional cap on claims this pass (defaults to maxConcurrentRuns)' },
        worker: { type: 'string', enum: ['headless', 'terminal', 'noop'], description: 'Override worker mode for execution (defaults to queue settings)' },
        actorId: { type: 'string', description: 'Employee id/name triggering the pass (requires run:create)' },
      },
    },
  },
];

export const EVENT_TOOLS = [
  {
    name: 'sprintdesk_eventsPublish',
    description: 'Publish an event record',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Event type (e.g., task.created)' },
        source: { type: 'string', description: 'Event source (e.g., mcp, agent, manual)' },
        payload: { type: 'object', description: 'Optional event payload' },
      },
      required: ['type', 'source'],
    },
  },
  {
    name: 'sprintdesk_eventsList',
    description: 'List recent events, optionally filtered',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Event type filter' },
        source: { type: 'string', description: 'Event source filter' },
        limit: { type: 'number', description: 'Max events to return' },
      },
    },
  },
];

export const HISTORY_TOOLS = [
  {
    name: 'sprintdesk_getHistory',
    description: 'Get change history for an item, or all recent history',
    inputSchema: {
      type: 'object' as const,
      properties: {
        itemId: { type: 'string', description: 'Item ID filter' },
        itemType: { type: 'string', enum: ['plan', 'run', 'checkpoint'], description: 'Item type filter' },
        limit: { type: 'number', description: 'Max entries to return' },
      },
    },
  },
  {
    name: 'sprintdesk_trackChange',
    description: 'Record a change-history entry',
    inputSchema: {
      type: 'object' as const,
      properties: {
        itemId: { type: 'string', description: 'Item ID' },
        itemType: { type: 'string', enum: ['plan', 'run', 'checkpoint'], description: 'Item type' },
        action: { type: 'string', enum: ['create', 'update', 'delete', 'move', 'assign'], description: 'Change action' },
        field: { type: 'string', description: 'Optional changed field' },
        oldValue: { type: 'string', description: 'Optional previous value' },
        newValue: { type: 'string', description: 'Optional new value' },
      },
      required: ['itemId', 'itemType', 'action'],
    },
  },
];

export const AUDIT_TOOLS = [
  {
    name: 'sprintdesk_auditList',
    description: 'List audit entries, optionally filtered by actor or target',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actor: { type: 'string', description: 'Actor filter' },
        targetType: { type: 'string', description: 'Target type filter' },
        targetId: { type: 'string', description: 'Target ID filter' },
        limit: { type: 'number', description: 'Max entries to return' },
      },
    },
  },
];

export const CONTEXT_TOOLS = [
  {
    name: 'sprintdesk_projectContext',
    description: 'Get a compact snapshot of the project: counts, statuses, active runs, recent events',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export const WORKFORCE_TOOLS = [
  {
    name: 'sprintdesk_skillsList',
    description: 'List the skill catalog (workforce/skills.yml), including aliases used for matching',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_skillsUpsert',
    description: 'Add or update a skill in the catalog (matched by id; falls back to name)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Skill id (e.g., skill_debugging)' },
        name: { type: 'string', description: 'Canonical skill name (e.g., debugging)' },
        category: { type: 'string', description: 'Optional category (e.g., engineering)' },
        description: { type: 'string', description: 'Optional one-line description' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Optional alias names' },
      },
      required: ['name'],
    },
  },
  {
    name: 'sprintdesk_policyGet',
    description: 'Get effective permissions for a role or an employee (RBAC matrix + allow/deny overrides)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        role: { type: 'string', description: 'Role to inspect (lead|developer|reviewer|observer|agent|human)' },
        employeeId: { type: 'string', description: 'Employee id or name; shows role + overrides applied' },
      },
    },
  },
  {
    name: 'sprintdesk_recommendEmployees',
    description: 'Deterministically rank employees for a plan or classification type by skill coverage -> lower load -> idle -> name -> id',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan id; its classification category/requiredSkills drive the match' },
        type: { type: 'string', enum: ['feature', 'bug', 'chore', 'doc', 'test'], description: 'Classification type when planId is not provided' },
        requiredSkills: { type: 'array', items: { type: 'string' }, description: 'Override required skills' },
        includePartial: { type: 'boolean', description: 'Include partial-coverage candidates (default false)' },
        maxResults: { type: 'number', description: 'Max ranked results (default all)' },
      },
    },
  },
  {
    name: 'sprintdesk_activitySummary',
    description: 'Overall workforce activity snapshot: employee/run/task counts, queue settings, and the latest 20 events',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export const MCP_TOOLS = [
  {
    name: 'sprintdesk_mcpServersList',
    description: 'List registered MCP servers',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_mcpServersAdd',
    description: 'Register an MCP server (stdio or http)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Unique server id (also used in mcp.<id>.<tool> capability ids)' },
        kind: { type: 'string', enum: ['stdio', 'http'], description: 'Transport kind' },
        name: { type: 'string', description: 'Display name' },
        description: { type: 'string', description: 'Description' },
        url: { type: 'string', description: 'HTTP endpoint for kind=http' },
        command: { type: 'string', description: 'Command for kind=stdio' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments for kind=stdio' },
        headersRef: { type: 'string', description: 'Credential ref (env:.. or secret:..) resolving to JSON headers' },
        timeoutMs: { type: 'number', description: 'Request timeout in ms' },
        enabled: { type: 'boolean', description: 'Enabled flag (default true)' },
      },
      required: ['id', 'kind'],
    },
  },
  {
    name: 'sprintdesk_mcpServersUpdate',
    description: 'Update a registered MCP server',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Server id' },
        kind: { type: 'string', enum: ['stdio', 'http'] },
        name: { type: 'string' },
        description: { type: 'string' },
        url: { type: 'string' },
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        headersRef: { type: 'string' },
        timeoutMs: { type: 'number' },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'sprintdesk_mcpServersRemove',
    description: 'Remove a registered MCP server',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Server id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'sprintdesk_mcpToolsList',
    description: 'List tools exposed by an MCP server (requires mcp:list permission and mcp.<server>.list capability for the acting employee)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serverId: { type: 'string', description: 'MCP server id' },
        agent: { type: 'string', description: 'Acting employee id or name' },
      },
      required: ['serverId'],
    },
  },
  {
    name: 'sprintdesk_mcpCheck',
    description: 'Dry-run safety check for a future MCP tool call (capability + permission + server state)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serverId: { type: 'string', description: 'MCP server id' },
        toolName: { type: 'string', description: 'Tool to check' },
        agent: { type: 'string', description: 'Acting employee id or name' },
      },
      required: ['serverId', 'toolName'],
    },
  },
  {
    name: 'sprintdesk_mcpCall',
    description: 'Invoke a tool on an MCP server through the safety chain (agent capability + employee permission)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serverId: { type: 'string', description: 'MCP server id' },
        toolName: { type: 'string', description: 'Tool name' },
        toolArgs: { type: 'object', description: 'Tool arguments' },
        agent: { type: 'string', description: 'Acting employee id or name' },
      },
      required: ['serverId', 'toolName'],
    },
  },
];

export const APPROVAL_TOOLS = [
  {
    name: 'sprintdesk_gatesGet',
    description: 'Read the current approval gate modes (plan-classification, run-execution, config-change, deploy-authorization): auto or manual',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sprintdesk_gatesSet',
    description: 'Set an approval gate mode (requires approval:configure)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gate: { type: 'string', enum: ['plan-classification', 'run-execution', 'config-change', 'deploy-authorization'], description: 'Which gate to configure' },
        mode: { type: 'string', enum: ['auto', 'manual'], description: 'auto = proceed without approval, manual = requires approval' },
        actorId: { type: 'string', description: 'Acting employee id or name (must hold approval:configure)' },
      },
      required: ['gate', 'mode'],
    },
  },
  {
    name: 'sprintdesk_approvalsList',
    description: 'List approval requests by status (default pending)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'Status filter (default pending)' },
        limit: { type: 'number', description: 'Max approvals to return' },
      },
    },
  },
  {
    name: 'sprintdesk_approvalsApprove',
    description: 'Approve a pending approval request and perform its deferred operation (requires approval:review)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        approvalId: { type: 'string', description: 'Approval id' },
        actorId: { type: 'string', description: 'Acting employee id or name (must hold approval:review)' },
      },
      required: ['approvalId', 'actorId'],
    },
  },
  {
    name: 'sprintdesk_approvalsReject',
    description: 'Reject a pending approval request (requires approval:review)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        approvalId: { type: 'string', description: 'Approval id' },
        actorId: { type: 'string', description: 'Acting employee id or name (must hold approval:review)' },
      },
      required: ['approvalId', 'actorId'],
    },
  },
  {
    name: 'sprintdesk_employeeConfigure',
    description: 'Update an employee modelProfile/agentConfig/capabilities (deferred to approval queue when config-change gate is manual)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        employeeId: { type: 'string', description: 'Employee id or name' },
        modelProfile: { type: 'object', description: 'Model profile: { name, provider (ollama|openai), model, baseUrl?, apiKeyRef?, options? }' },
        agentConfig: { type: 'object', description: 'Agent config: { tool, command?, model?, workingDir?, promptTemplate? }' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Replacement capability list' },
        actorId: { type: 'string', description: 'Acting employee id or name' },
      },
      required: ['employeeId'],
    },
  },
];

export const INPUT_TOOLS = [
  {
    name: 'sprintdesk_inputsList',
    description: 'List all inputs (raw work requests flowing through the plan pipeline)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'classified', 'failed'], description: 'Status filter' },
        limit: { type: 'number', description: 'Max inputs to return' },
      },
    },
  },
  {
    name: 'sprintdesk_inputsIngest',
    description: 'Ingest a new raw input into the plan pipeline',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Input title' },
        description: { type: 'string', description: 'Optional description' },
        source: { type: 'string', description: 'Source identifier (e.g. mcp, agent, manual)' },
        category: { type: 'string', description: 'Optional category hint' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority hint' },
      },
      required: ['title'],
    },
  },
];

export const PLAN_TOOLS = [
  {
    name: 'sprintdesk_plansList',
    description: 'List plans in the plan registry',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['draft', 'active', 'completed', 'failed'], description: 'Status filter' },
        inputId: { type: 'string', description: 'Filter by source input ID' },
        limit: { type: 'number', description: 'Max plans to return' },
      },
    },
  },
  {
    name: 'sprintdesk_plansGet',
    description: 'Get a plan by ID or code',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID or code' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'sprintdesk_plansReplan',
    description: 'Replan a failed or stale plan (creates a new cycle + queued run)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID or code' },
        reason: { type: 'string', description: 'Optional replan reason' },
      },
      required: ['planId'],
    },
  },
];

export const CHECKPOINT_TOOLS = [
  {
    name: 'sprintdesk_checkpointsList',
    description: 'List checkpoints for a run or plan',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'Run ID filter' },
        planId: { type: 'string', description: 'Plan ID filter' },
        status: { type: 'string', enum: ['ready', 'deployment-authorizing', 'deployed', 'failed'], description: 'Status filter' },
      },
    },
  },
  {
    name: 'sprintdesk_checkpointsApproveDeploy',
    description: 'Approve a checkpoint deploy authorization (resolves pending deploy-authorization approval)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        checkpointId: { type: 'string', description: 'Checkpoint ID' },
        actorId: { type: 'string', description: 'Approving employee id (must hold plan:deploy)' },
      },
      required: ['checkpointId', 'actorId'],
    },
  },
  {
    name: 'sprintdesk_checkpointsRejectDeploy',
    description: 'Reject a checkpoint deploy authorization',
    inputSchema: {
      type: 'object' as const,
      properties: {
        checkpointId: { type: 'string', description: 'Checkpoint ID' },
        actorId: { type: 'string', description: 'Rejecting employee id (must hold plan:deploy)' },
      },
      required: ['checkpointId', 'actorId'],
    },
  },
];

export const CYCLE_TOOLS = [
  {
    name: 'sprintdesk_cyclesList',
    description: 'List execution cycles for a plan or input',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID filter' },
        inputId: { type: 'string', description: 'Input ID filter' },
      },
    },
  },
];

export const ORGANIZER_TOOLS = [
  {
    name: 'sprintdesk_organizerRun',
    description: 'Run one organizer pass: classify inputs → create/update plans → queue runs',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dryRun: { type: 'boolean', description: 'If true, report what would happen without writing' },
      },
    },
  },
];

export const ALL_TOOLS = [
  ...AGENT_TOOLS,
  ...RUN_TOOLS,
  ...QUEUE_TOOLS,
  ...EVENT_TOOLS,
  ...HISTORY_TOOLS,
  ...AUDIT_TOOLS,
  ...CONTEXT_TOOLS,
  ...WORKFORCE_TOOLS,
  ...MCP_TOOLS,
  ...APPROVAL_TOOLS,
  ...INPUT_TOOLS,
  ...PLAN_TOOLS,
  ...CHECKPOINT_TOOLS,
  ...CYCLE_TOOLS,
  ...ORGANIZER_TOOLS,
];

export function getToolByName(name: string) {
  return ALL_TOOLS.find(t => t.name === name);
}

export function getAllToolNames(): string[] {
  return ALL_TOOLS.map(t => t.name);
}