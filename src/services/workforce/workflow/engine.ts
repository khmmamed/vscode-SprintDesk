import {
  Plan,
  Run,
  WorkflowConditionStep,
  WorkflowDefinition,
  WorkflowLoopStep,
  WorkflowRunResult,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowTaskStep,
  WorkflowToolStep
} from '../../../data/types';
import { DataService, getDataService } from '../../../data/DataService';
import { getStores, Stores } from '../../../data/stores';
import { emitEvent } from '../events';
import { callServerTool } from '../mcp/client';
import { evaluateCondition, interpolate, validateWorkflow } from './dsl';
import { legacyTaskKindToPlanCategory, materializePlan } from '../plan/planService';

export interface WorkflowContext {
  workflowId: string;
  workflowName: string;
  stepOutputs: Map<string, WorkflowStepResult>;
  variables: Record<string, unknown>;
}

export interface ExecuteWorkflowOptions {
  now?: Date;
  dataService?: DataService;
  stores?: Stores;
}

function createContext(workflowId: string, workflowName: string): WorkflowContext {
  return {
    workflowId,
    workflowName,
    stepOutputs: new Map<string, WorkflowStepResult>(),
    variables: {}
  };
}

function failed(stepId: string, error: string, outputs: Record<string, unknown> = {}): WorkflowStepResult {
  return { stepId, status: 'failed', outputs, error };
}

function completed(stepId: string, outputs: Record<string, unknown> = {}): WorkflowStepResult {
  return { stepId, status: 'completed', outputs };
}

function skipped(stepId: string, outputs: Record<string, unknown> = {}): WorkflowStepResult {
  return { stepId, status: 'skipped', outputs };
}

function taskTitle(step: WorkflowTaskStep, context: WorkflowContext): string {
  const interpolated = interpolate(step.title, context.variables);
  return typeof interpolated === 'string' ? interpolated : step.title;
}

function createWorkflowRun(stores: Stores, now: Date, context: WorkflowContext, plan: Plan): Run {
  const run: Run = {
    id: `run_wf_${context.workflowId}_${plan.id}_${now.getTime()}`,
    planId: plan.id,
    status: 'queued',
    attempts: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  stores.runs.add(run);
  emitEvent('run.queued', 'workflow', {
    runId: run.id,
    planId: plan.id,
    workflowId: context.workflowId,
    workflowName: context.workflowName
  });
  return run;
}

// v1.0 Slice D — `task` steps materialize runnable Plans (the queue's execution
// unit) with provenance `synthetic:workflow:<id>`; step outputs carry planId.
function executeTaskStep(
  step: WorkflowTaskStep,
  context: WorkflowContext,
  now: Date,
  dataService: DataService,
  stores: Stores
): WorkflowStepResult {
  const title = taskTitle(step, context);
  try {
    const plan = materializePlan(
      {
        sourceInputId: `synthetic:workflow:${context.workflowId}`,
        title,
        description: context.workflowName,
        category: legacyTaskKindToPlanCategory(step.taskType),
        priority: step.priority
      },
      { stores }
    );

    const run = createWorkflowRun(stores, now, context, plan);
    return completed(step.id, { planId: plan.id, runId: run.id, backlog: !!step.backlog });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(step.id, `task step '${step.id}' failed: ${message}`);
  }
}

async function executeToolStep(step: WorkflowToolStep, context: WorkflowContext, now: Date): Promise<WorkflowStepResult> {
  const args = interpolate(step.args, context.variables) as Record<string, unknown>;
  const agent = String(interpolate(step.agent, context.variables));
  try {
    const result = await callServerTool(step.serverId, step.toolName, args, { agentIdOrName: agent });
    return completed(step.id, {
      content: result.content,
      isError: !!result.isError,
      serverId: step.serverId,
      toolName: step.toolName
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(step.id, `tool step '${step.id}' failed: ${message}`);
  }
}

async function executeLoopStep(
  step: WorkflowLoopStep,
  context: WorkflowContext,
  now: Date,
  dataService: DataService,
  stores: Stores
): Promise<WorkflowStepResult> {
  const results: WorkflowStepResult[] = [];
  for (let index = 0; index < step.maxIterations; index += 1) {
    context.variables[step.iterateVar] = index;
    for (const bodyStep of step.body) {
      const result = await executeStep(bodyStep, context, now, dataService, stores);
      results.push(result);
      context.stepOutputs.set(bodyStep.id, result);
      if (result.status === 'failed' && !bodyStep.continueOnError) {
        return failed(
          step.id,
          `loop step '${step.id}' failed at iteration ${index} (step '${bodyStep.id}'): ${result.error ?? 'unknown error'}`,
          { iterations: index + 1, results }
        );
      }
    }
  }
  return completed(step.id, { iterations: step.maxIterations, results });
}

async function executeConditionStep(
  step: WorkflowConditionStep,
  context: WorkflowContext,
  now: Date,
  dataService: DataService,
  stores: Stores
): Promise<WorkflowStepResult> {
  const takeThen = evaluateCondition(step.when, context.stepOutputs);
  const branch = takeThen ? step.then : step.else;
  if (!branch || branch.length === 0) {
    return skipped(step.id, { branch: takeThen ? 'then' : 'else' });
  }
  const results: WorkflowStepResult[] = [];
  for (const branchStep of branch) {
    const result = await executeStep(branchStep, context, now, dataService, stores);
    results.push(result);
    context.stepOutputs.set(branchStep.id, result);
    if (result.status === 'failed' && !branchStep.continueOnError) {
      return failed(
        step.id,
        `condition step '${step.id}' failed (branch step '${branchStep.id}'): ${result.error ?? 'unknown error'}`,
        { branch: takeThen ? 'then' : 'else', results }
      );
    }
  }
  return completed(step.id, { branch: takeThen ? 'then' : 'else', results });
}

async function executeStep(
  step: WorkflowStep,
  context: WorkflowContext,
  now: Date,
  dataService: DataService,
  stores: Stores
): Promise<WorkflowStepResult> {
  switch (step.type) {
    case 'task':
      return executeTaskStep(step, context, now, dataService, stores);
    case 'loop':
      return executeLoopStep(step, context, now, dataService, stores);
    case 'tool':
      return executeToolStep(step, context, now);
    case 'condition':
      return executeConditionStep(step, context, now, dataService, stores);
    default:
      return failed((step as { id: string; type: string }).id, `unsupported step type '${(step as { type: string }).type}'`);
  }
}

export async function executeWorkflow(workflow: WorkflowDefinition, options: ExecuteWorkflowOptions = {}): Promise<WorkflowRunResult> {
  validateWorkflow(workflow);

  const now = options.now ?? new Date();
  const dataService = options.dataService ?? getDataService();
  const stores = options.stores ?? getStores(dataService.getWorkspaceRoot());
  const context = createContext(workflow.id, workflow.name);
  const stepResults: WorkflowStepResult[] = [];

  for (const step of workflow.steps) {
    const result = await executeStep(step, context, now, dataService, stores);
    stepResults.push(result);
    context.stepOutputs.set(step.id, result);

    if (result.status === 'failed' && !step.continueOnError) {
      const error = `workflow '${workflow.id}' failed at step '${step.id}': ${result.error ?? 'unknown error'}`;
      emitEvent('workflow.failed', 'workflow', {
        workflowId: workflow.id,
        workflowName: workflow.name,
        stepId: step.id,
        error
      });
      return { workflowId: workflow.id, name: workflow.name, executedAt: now.toISOString(), status: 'failed', stepResults, error };
    }
  }

  emitEvent('workflow.completed', 'workflow', {
    workflowId: workflow.id,
    workflowName: workflow.name,
    stepCount: stepResults.length
  });
  return { workflowId: workflow.id, name: workflow.name, executedAt: now.toISOString(), status: 'completed', stepResults };
}