import * as path from 'path';
import { EmployeeModelProfile } from '../../../data/types';
import { readFileSyncSafe } from '../../fileService';
import { getLLMProvider } from '../llm/registry';
import { ChatMessage, LLMProvider, profileToRequest } from '../llm/types';
import { DEFAULT_OLLAMA_BASEURL } from '../llm/ollamaProvider';
import { WorkerRequest, WorkerResult, WorkerRuntime } from './worker';

const DEFAULT_OLLAMA_MODEL = 'llama3';
const MAX_TASK_CHARS = 8000;

function resolveProfile(request: WorkerRequest): EmployeeModelProfile | undefined {
  if (request.modelProfile) {return request.modelProfile;}
  if (!request.agentConfig?.model) {return undefined;}
  return {
    name: request.employee.name,
    provider: 'ollama',
    model: request.agentConfig.model,
    baseUrl: DEFAULT_OLLAMA_BASEURL
  };
}

function readTaskContent(request: WorkerRequest): string {
  const taskPath = request.task.path;
  if (!taskPath) {return '';}
  const absolute = path.isAbsolute(taskPath) ? taskPath : path.join(request.workspaceRoot, taskPath);
  try {
    return readFileSyncSafe(absolute);
  } catch {
    return '';
  }
}

export function createOllamaWorker(providerOverride?: LLMProvider): WorkerRuntime {
  return {
    mode: 'ollama' as const,
    async run(request: WorkerRequest): Promise<WorkerResult> {
      const profile = resolveProfile(request);
      if (!profile?.model) {
        return {
          status: 'failed',
          error: 'Agent has no model configured (set modelProfile or agentConfig.model)',
          classification: 'invalid-config'
        };
      }

      const taskContent = readTaskContent(request);
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: [
            `You are ${request.employee.name}, an AI workforce agent.`,
            'Execute the assigned task and report the outcome.',
            'End your answer with two sections:',
            'Findings:',
            '- one bullet line per finding',
            'Errors:',
            '- one bullet line per error, or the single line "Errors: 0" when there are none'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Task: ${request.task.title}`,
            taskContent ? `Task description:\n${taskContent.slice(0, MAX_TASK_CHARS)}` : ''
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ];

      const provider = providerOverride || getLLMProvider(profile);
      try {
        const response = await provider.chat(profileToRequest(profile, messages));
        const output = (response.text || '').trim();
        if (!output) {
          return { status: 'failed', error: 'Model returned an empty response', classification: 'spawn-error' };
        }
        return { status: 'completed', output };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { status: 'failed', error: message, classification: 'spawn-error' };
      }
    }
  };
}

export { DEFAULT_OLLAMA_MODEL };