import { runOrganizerPass } from '../../services/workforce/plan/organizer';
import { Handler, HandlerResult, res, getWs } from './helpers';

function handle_sprintdesk_organizerRun(args: any): HandlerResult {
  const root = getWs();
  if (!root) return res('No workspace found', true);

  try {
    const result = runOrganizerPass({ workspaceRoot: root });
    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

export const ORGANIZER_HANDLERS: Record<string, Handler> = {
  sprintdesk_organizerRun: handle_sprintdesk_organizerRun,
};
