import { getActivitySummary } from '../../services/workforce/observability';
import { Handler, HandlerResult, res } from './helpers';

function handle_sprintdesk_activitySummary(): HandlerResult {
  return res(JSON.stringify(getActivitySummary(), null, 2));
}

export const ACTIVITY_HANDLERS: Record<string, Handler> = {
  sprintdesk_activitySummary: handle_sprintdesk_activitySummary
};