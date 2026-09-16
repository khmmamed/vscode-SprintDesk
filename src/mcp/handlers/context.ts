import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res, getWs, getDs } from './helpers';

function handle_sprintdesk_projectContext(_args: any): HandlerResult {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const tasks = ds.loadTasks();
  const taskStatusCounts: Record<string, number> = {};
  tasks.forEach(t => {
    taskStatusCounts[t.status] = (taskStatusCounts[t.status] || 0) + 1;
  });

  const stores = getStores();
  const config = ds.loadConfig();

  const context = {
    workspace: getWs(),
    projectPrefix: config.projectPrefix,
    counts: {
      tasks: tasks.length,
      epics: ds.loadEpics().length,
      sprints: ds.loadSprints().length,
      backlogs: ds.loadBacklogs().length,
      runs: stores.runs.count(),
      events: stores.events.count(),
      employees: stores.people.count()
    },
    tasksByStatus: taskStatusCounts,
    activeRuns: stores.runs.findByStatus('running').length,
    latestEvents: stores.events.latest(10).map(e => ({ id: e.id, type: e.type, source: e.source, timestamp: e.timestamp })),
    hasOpenTasks: tasks.some(t => t.status === 'in-progress')
  };

  return res(JSON.stringify(context, null, 2));
}

export const CONTEXT_HANDLERS: Record<string, Handler> = {
  sprintdesk_projectContext: handle_sprintdesk_projectContext,
};