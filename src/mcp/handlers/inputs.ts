import * as path from 'path';
import * as fs from 'fs';
import * as orchestrator from '../../services/workforce/orchestrator';
import { Handler, HandlerResult, res, getWs } from './helpers';

function handle_sprintdesk_inputsList(args: any): HandlerResult {
  const root = getWs();
  if (!root) return res('No workspace found', true);

  const inputs = orchestrator.listInputs(root);
  let filtered = inputs;

  if (args.limit && typeof args.limit === 'number') {
    filtered = filtered.slice(0, args.limit);
  }

  return res(JSON.stringify(filtered, null, 2));
}

function handle_sprintdesk_inputsIngest(args: any): HandlerResult {
  const root = getWs();
  if (!root) return res('No workspace found', true);

  try {
    const inputsDir = orchestrator.inputsDir(root);
    fs.mkdirSync(inputsDir, { recursive: true });

    const title = args.title || 'Untitled';
    const filename = `${title.replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.md`;
    const filePath = path.join(inputsDir, filename);

    const lines = [`# ${title}`, ''];
    if (args.description) lines.push(args.description, '');
    if (args.category) lines.push(`**Category:** ${args.category}`, '');
    if (args.priority) lines.push(`**Priority:** ${args.priority}`, '');

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    const input = orchestrator.ingestInput(filePath, { source: { type: 'agent', id: args.source || 'mcp' } });
    return res(JSON.stringify(input, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

export const INPUT_HANDLERS: Record<string, Handler> = {
  sprintdesk_inputsList: handle_sprintdesk_inputsList,
  sprintdesk_inputsIngest: handle_sprintdesk_inputsIngest,
};
