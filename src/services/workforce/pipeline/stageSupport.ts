import { createHash } from 'crypto';
import * as path from 'path';
import { getStores } from '../../../data/stores';
import { getWorkspaceRoot } from '../../../services/fileService';
import { getHost, getFileSystem } from '../../../host';
import { emitEvent } from '../events';
import { memberForRole } from '../orchestration/roles';
import { getLLMProvider } from '../llm/registry';
import { profileToRequest } from '../llm/types';
import { DEFAULT_OLLAMA_BASEURL } from '../llm/ollamaProvider';
import { readPlanMd, resolvePlanFile, writePlanMd, PlanMdSections } from '../plan/planService';
import {
  Employee,
  EmployeeModelProfile,
  OrchestrationRole,
  Plan,
  PlanPipeline,
  PlanPipelineStage,
  PlanPipelineStageRecord
} from '../../../data/types';

export const PIPELINE_EVENT_SOURCE = 'pipeline';

export function resolveRoot(workspaceRoot?: string): string {
  return workspaceRoot || getWorkspaceRoot() || getHost().getWorkspaceRoot() || '';
}

export function planFilePath(plan: Pick<Plan, 'id' | 'file'>, root: string): string {
  return path.join(root, '.SprintDesk', resolvePlanFile(plan as Plan));
}

export function relayLoad(planId: string, root: string): Plan | undefined {
  return getStores(root).plans.getById(planId);
}

export function readSections(plan: Plan, root: string): PlanMdSections {
  const file = planFilePath(plan, root);
  if (!getFileSystem().exists(file)) {
    return { objective: '', implementation: '', acceptanceCriteria: '', constraints: '' };
  }
  return readPlanMd(file).sections;
}

export function coreSections(sections: PlanMdSections): PlanMdSections {
  return {
    objective: sections.objective,
    implementation: sections.implementation,
    acceptanceCriteria: sections.acceptanceCriteria,
    constraints: sections.constraints
  };
}

// Stable idempotence key over everything a stage consumes, excluding that stage's
// own output so re-running it after a self-rewrite is correctly a no-op.
export function hashParts(parts: unknown[]): string {
  return createHash('sha1')
    .update(parts.map(part => JSON.stringify(part ?? '')).join('|'))
    .digest('hex');
}

export function lastRecord(plan: Plan, stage: PlanPipelineStage): PlanPipelineStageRecord | undefined {
  return lastRecordFor(plan, [stage]);
}

export function lastRecordFor(
  plan: Plan,
  stages: PlanPipelineStage[]
): PlanPipelineStageRecord | undefined {
  const history = plan.pipeline?.history || [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (stages.includes(history[i].stage)) {
      return history[i];
    }
  }
  return undefined;
}

export interface StageMember {
  id?: string;
  profile?: EmployeeModelProfile;
}

export function resolveMemberProfile(employee: Employee | undefined, root: string): EmployeeModelProfile | undefined {
  if (!employee) {
    return undefined;
  }
  if (employee.modelProfile) {
    return employee.modelProfile;
  }
  if (employee.modelId) {
    const model = getStores(root).models.getById(employee.modelId);
    if (model) {
      return {
        name: model.name,
        provider: model.provider,
        model: model.model,
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(model.apiKeyRef ? { apiKeyRef: model.apiKeyRef } : {}),
        ...(model.options ? { options: model.options } : {})
      };
    }
  }
  if (employee.agentConfig?.model) {
    return {
      name: employee.name,
      provider: 'ollama',
      model: employee.agentConfig.model,
      baseUrl: DEFAULT_OLLAMA_BASEURL
    };
  }
  return undefined;
}

export function resolveStageMember(role: OrchestrationRole, root: string): StageMember {
  const employee = memberForRole(role, root);
  if (!employee) {
    return {};
  }
  return { id: employee.id, profile: resolveMemberProfile(employee, root) };
}

// Single-shot LLM text call. Any failure or empty output is a no-op so callers
// fall back to their deterministic path; a stage never fails the pipeline.
export async function runLlmText(
  profile: EmployeeModelProfile | undefined,
  system: string,
  user: string
): Promise<string | undefined> {
  if (!profile?.model) {
    return undefined;
  }
  try {
    const provider = getLLMProvider(profile);
    const response = await provider.chat(
      profileToRequest(profile, [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ])
    );
    const text = (response.text || '').trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export interface CommitStageInput {
  plan: Plan;
  root: string;
  stage: PlanPipelineStage;
  source: 'deterministic' | 'llm';
  memberId?: string;
  hash?: string;
  sections?: Array<{ key: keyof PlanMdSections; value: string }>;
  registryPatch?: Partial<Plan>;
}

// Advances one stage: applies the registry patch + pipeline record, rewrites the
// plan file with the stage's section, mirrors the stage into front-matter, and
// emits an observable stage event. Returns the reloaded Plan.
export function commitStage(input: CommitStageInput): Plan {
  const stores = getStores(input.root);
  const now = new Date().toISOString();
  const sections = readSections(input.plan, input.root);
  for (const entry of input.sections || []) {
    sections[entry.key] = entry.value;
  }

  const record: PlanPipelineStageRecord = {
    stage: input.stage,
    at: now,
    source: input.source,
    ...(input.memberId ? { by: input.memberId } : {}),
    ...(input.hash ? { hash: input.hash } : {})
  };
  const pipeline: PlanPipeline = {
    stage: input.stage,
    updatedAt: now,
    history: [...(input.plan.pipeline?.history || []), record]
  };

  stores.plans.update(input.plan.id, {
    ...(input.registryPatch || {}),
    pipeline,
    updatedAt: now
  });

  const reloaded = stores.plans.getById(input.plan.id) || input.plan;
  writePlanMd(reloaded, sections, input.root);

  emitEvent('plan.pipeline.stage', PIPELINE_EVENT_SOURCE, {
    planId: reloaded.id,
    stage: input.stage,
    source: input.source,
    memberId: input.memberId
  });
  if (input.stage === 'ready') {
    emitEvent('plan.ready', PIPELINE_EVENT_SOURCE, {
      planId: reloaded.id,
      memberId: input.memberId
    });
  }
  return reloaded;
}
