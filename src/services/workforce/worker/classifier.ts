import { Employee, EmployeeModelProfile, Finding, Task } from '../../../data/types';
import { getStores } from '../../../data/stores';
import { getLLMProvider } from '../llm/registry';
import { ChatMessage, LLMProvider, profileToRequest } from '../llm/types';
import { DEFAULT_OLLAMA_BASEURL } from '../llm/ollamaProvider';
import { ProposalClassification } from '../classification/classificationService';

const TASK_TYPES = ['feature', 'bug', 'chore', 'doc', 'test'] as const;
const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;

export type ClassificationOutcome =
  | { ok: true; value: ProposalClassification }
  | { ok: false; reason: string };

function resolveProfile(employee: Employee): EmployeeModelProfile | undefined {
  if (employee.modelProfile) {return employee.modelProfile;}
  if (!employee.agentConfig?.model) {return undefined;}
  return {
    name: employee.name,
    provider: 'ollama',
    model: employee.agentConfig.model,
    baseUrl: DEFAULT_OLLAMA_BASEURL
  };
}

export function buildClassificationPrompt(finding: Finding): ChatMessage[] {
  const context = [
    `Title: ${finding.title}`,
    finding.description ? `Description: ${finding.description}` : '',
    `Severity: ${finding.severity}`,
    finding.category ? `Category: ${finding.category}` : '',
    finding.evidence ? `Evidence: ${finding.evidence}` : '',
    finding.suggestedTaskType ? `Suggested type: ${finding.suggestedTaskType}` : '',
    finding.suggestedWorkflow ? `Suggested workflow: ${finding.suggestedWorkflow}` : '',
    finding.suggestedPriority ? `Suggested priority: ${finding.suggestedPriority}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const system = [
    'You are a task classifier for an autonomous workforce control center.',
    'Classify the finding into a task proposal. Respond with a single JSON object only, of the shape:',
    '{"title": string, "type": "feature"|"bug"|"chore"|"doc"|"test", "priority": "high"|"medium"|"low", "workflow": string (optional), "confidence": number 0-1 (optional)}.',
    'Do not include any text outside the JSON object.'
  ].join(' ');

  return [
    { role: 'system', content: system },
    { role: 'user', content: context }
  ];
}

export function parseClassification(output: string): ClassificationOutcome {
  const cleaned = output.replace(/```(?:json)?/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return { ok: false, reason: 'model output contained no JSON object' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'model output was not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'model output was not an object' };
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : undefined;
  const type = typeof parsed.type === 'string' && (TASK_TYPES as readonly string[]).includes(parsed.type)
    ? parsed.type as Task['type']
    : undefined;
  const priority = typeof parsed.priority === 'string' && (TASK_PRIORITIES as readonly string[]).includes(parsed.priority)
    ? parsed.priority as Task['priority']
    : undefined;
  const workflow = typeof parsed.workflow === 'string' && parsed.workflow.trim().length > 0
    ? parsed.workflow.trim()
    : undefined;
  const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
    ? parsed.confidence
    : undefined;

  if (!title && !type) {
    return { ok: false, reason: 'model output had no usable classification fields' };
  }

  const value: ProposalClassification = {
    ...(title ? { title } : {}),
    ...(type ? { type } : {}),
    ...(priority ? { priority } : {}),
    ...(workflow ? { workflow } : {}),
    ...(confidence !== undefined ? { confidence } : {})
  };
  return { ok: true, value };
}

export async function classifyFinding(
  finding: Finding,
  options: { providerOverride?: LLMProvider } = {}
): Promise<ClassificationOutcome> {
  const employee = getStores().employees.loadAll().find(e => e.id === finding.agent || e.name === finding.agentName);
  if (!employee) {
    return { ok: false, reason: 'no employee found for the finding' };
  }

  const profile = resolveProfile(employee);
  if (!profile?.model) {
    return { ok: false, reason: 'no model configured for classification (set modelProfile or agentConfig.model)' };
  }

  const provider = options.providerOverride || getLLMProvider(profile);
  try {
    const response = await provider.chat(profileToRequest(profile, buildClassificationPrompt(finding)));
    const output = (response.text || '').trim();
    if (!output) {
      return { ok: false, reason: 'model returned an empty response' };
    }
    return parseClassification(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}