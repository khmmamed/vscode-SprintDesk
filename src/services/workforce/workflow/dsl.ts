import { WorkflowCondition, WorkflowDefinition, WorkflowStep, WorkflowStepResult } from '../../../data/types';

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

const STEP_TYPE_RE = /^[a-z][a-zA-Z0-9_.-]*$/;
const VAR_TOKEN_RE = /\{(\w+)\}/g;

export function interpolate(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(VAR_TOKEN_RE, (match, key: string) =>
      vars[key] !== undefined ? String(vars[key]) : match
    );
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolate(v, vars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = interpolate(v, vars);
    }
    return out;
  }
  return value;
}

export function evaluateCondition(
  condition: WorkflowCondition,
  stepOutputs: ReadonlyMap<string, WorkflowStepResult>
): boolean {
  if (condition.type === 'always') {
    return true;
  }
  if (condition.type === 'never') {
    return false;
  }
  if (condition.type === 'step-status') {
    const result = stepOutputs.get(condition.stepId);
    return !!result && result.status === condition.expectedStatus;
  }
  return false;
}

export function validateStep(step: WorkflowStep, path: string): void {
  if (!step.id || !STEP_TYPE_RE.test(step.id)) {
    throw new WorkflowValidationError(`${path}: step id '${step.id}' is invalid (expected /^[a-z][a-zA-Z0-9_.-]*$/)`);
  }

  switch (step.type) {
    case 'task': {
      if (!step.title || step.title.trim().length === 0) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): task step requires a title`);
      }
      if (!step.taskType) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): task step requires taskType`);
      }
      if (!step.priority) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): task step requires priority`);
      }
      return;
    }
    case 'loop': {
      if (!Number.isInteger(step.maxIterations) || step.maxIterations < 1) {
        throw new WorkflowValidationError(
          `${path} (step '${step.id}'): loop maxIterations must be a positive integer, got '${step.maxIterations}'`
        );
      }
      if (!step.iterateVar || !/^[a-zA-Z_]\w*$/.test(step.iterateVar)) {
        throw new WorkflowValidationError(
          `${path} (step '${step.id}'): loop iterateVar must be a valid identifier, got '${step.iterateVar}'`
        );
      }
      if (!Array.isArray(step.body) || step.body.length === 0) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): loop body must not be empty`);
      }
      step.body.forEach((bodyStep, index) => validateStep(bodyStep, `${path}.body[${index}]`));
      return;
    }
    case 'tool': {
      if (!step.serverId || !STEP_TYPE_RE.test(step.serverId)) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): tool step requires a valid serverId`);
      }
      if (!step.toolName || !STEP_TYPE_RE.test(step.toolName)) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): tool step requires a valid toolName`);
      }
      if (!step.agent || step.agent.trim().length === 0) {
        throw new WorkflowValidationError(
          `${path} (step '${step.id}'): tool step requires an agent to enforce capability/permission gates`
        );
      }
      return;
    }
    case 'condition': {
      const when = step.when;
      if (!when || (when.type !== 'always' && when.type !== 'never' && when.type !== 'step-status')) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): unsupported condition type`);
      }
      if (when.type === 'step-status') {
        if (!when.stepId || !STEP_TYPE_RE.test(when.stepId)) {
          throw new WorkflowValidationError(`${path} (step '${step.id}'): step-status condition requires a stepId`);
        }
        if (when.expectedStatus !== 'completed' && when.expectedStatus !== 'failed') {
          throw new WorkflowValidationError(`${path} (step '${step.id}'): step-status condition expects 'completed' or 'failed'`);
        }
      }
      if (!Array.isArray(step.then) || step.then.length === 0) {
        throw new WorkflowValidationError(`${path} (step '${step.id}'): condition then-branch must not be empty`);
      }
      step.then.forEach((branchStep, index) => validateStep(branchStep, `${path}.then[${index}]`));
      if (step.else) {
        step.else.forEach((branchStep, index) => validateStep(branchStep, `${path}.else[${index}]`));
      }
      return;
    }
    default:
      throw new WorkflowValidationError(`${path}: unsupported step type '${(step as { type: string }).type}'`);
  }
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): void {
  if (!workflow) {
    throw new WorkflowValidationError('workflow definition is required');
  }
  if (!workflow.id || !STEP_TYPE_RE.test(workflow.id)) {
    throw new WorkflowValidationError(`workflow id '${workflow.id}' is invalid`);
  }
  if (!workflow.name || workflow.name.trim().length === 0) {
    throw new WorkflowValidationError(`workflow '${workflow.id}' requires a name`);
  }
  if (!workflow.version) {
    throw new WorkflowValidationError(`workflow '${workflow.id}' requires a version`);
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new WorkflowValidationError(`workflow '${workflow.id}' must define at least one step`);
  }

  const seenIds = new Set<string>();
  const collectIds = (steps: WorkflowStep[]): void => {
    for (const step of steps) {
      if (seenIds.has(step.id)) {
        throw new WorkflowValidationError(`duplicate step id '${step.id}' in workflow '${workflow.id}'`);
      }
      seenIds.add(step.id);
      if (step.type === 'loop') {
        collectIds(step.body);
      } else if (step.type === 'condition') {
        collectIds(step.then);
        if (step.else) {
          collectIds(step.else);
        }
      }
    }
  };

  workflow.steps.forEach((step, index) => validateStep(step, `steps[${index}]`));
  collectIds(workflow.steps);
}

function collectStepIds(steps: WorkflowStep[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    ids.add(step.id);
    if (step.type === 'loop') {
      for (const id of collectStepIds(step.body)) {
        ids.add(id);
      }
    } else if (step.type === 'condition') {
      for (const id of collectStepIds(step.then)) {
        ids.add(id);
      }
      if (step.else) {
        for (const id of collectStepIds(step.else)) {
          ids.add(id);
        }
      }
    }
  }
  return ids;
}

// Guard: step-status conditions may only reference sibling steps defined in the
// same workflow so control flow can never depend on external content.
export function validateConditionReferences(workflow: WorkflowDefinition): void {
  const ids = collectStepIds(workflow.steps);
  const walk = (steps: WorkflowStep[]): void => {
    for (const step of steps) {
      if (step.type === 'condition' && step.when.type === 'step-status') {
        if (!ids.has(step.when.stepId)) {
          throw new WorkflowValidationError(
            `condition step '${step.id}' references unknown step '${step.when.stepId}'`
          );
        }
      }
      if (step.type === 'loop') {
        walk(step.body);
      } else if (step.type === 'condition') {
        walk(step.then);
        if (step.else) {
          walk(step.else);
        }
      }
    }
  };
  walk(workflow.steps);
}

export function validateWorkflow(raw: unknown): WorkflowDefinition {
  const workflow = raw as WorkflowDefinition;
  validateWorkflowDefinition(workflow);
  validateConditionReferences(workflow);
  return workflow;
}