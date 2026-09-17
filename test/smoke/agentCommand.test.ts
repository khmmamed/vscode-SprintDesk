import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { makeAgentConfig } from '../helpers/workspace';
import { buildAgentCommand, sanitizeBranchName } from '../../src/services/workforce/worker/commandBuilder';

const planPath = path.join('/ws', '.SprintDesk', 'plans', 'PLAN-001.md');
const planDir = path.dirname(planPath);
const planFile = path.basename(planPath);
const description = 'Implement-the-thing';
const title = 'PLAN-001';
const agentName = 'Ada';

describe('agent command contract (Slice Q)', () => {
  it('returns no command when no agent config is present', () => {
    assert.deepEqual(buildAgentCommand(undefined, planPath, description, title, agentName), { command: '', args: [] });
  });

  it('opencode receives the full plan prompt unchanged', () => {
    const { command, args } = buildAgentCommand(makeAgentConfig({ tool: 'opencode' }), planPath, description, title, agentName);
    assert.equal(command, 'opencode');
    assert.deepEqual(args, ['-s', '--prompt', `[${agentName}] ${description}\n\nPlan: ${title}\nWork in: ${planDir}`]);
  });

  it('ollama falls back to llama3 and builds a plan prompt', () => {
    const { command, args } = buildAgentCommand(makeAgentConfig({ tool: 'ollama', model: undefined }), planPath, description, title, agentName);
    assert.equal(command, 'ollama');
    assert.deepEqual(args, ['run', 'llama3', `Plan: ${title}\nWork in: ${planDir}`]);
  });

  it('ollama uses the configured model', () => {
    const { args } = buildAgentCommand(makeAgentConfig({ tool: 'ollama', model: 'qwen2' }), planPath, description, title, agentName);
    assert.deepEqual(args, ['run', 'qwen2', `Plan: ${title}\nWork in: ${planDir}`]);
  });

  it('claude-code keeps its external --task flag and passes the plan path', () => {
    const { command, args } = buildAgentCommand(makeAgentConfig({ tool: 'claude-code' }), planPath, description, title, agentName);
    assert.equal(command, 'claude');
    assert.deepEqual(args, ['code', '--task', planPath]);
  });

  it('custom substitutes the plan path placeholders', () => {
    const command = 'run --path {plan_path} --dir {plan_dir} --file {plan_file}';
    const built = buildAgentCommand(makeAgentConfig({ tool: 'custom', command }), planPath, description, title, agentName);
    assert.equal(built.command, 'run');
    assert.deepEqual(built.args, ['--path', planPath, '--dir', planDir, '--file', planFile]);
  });

  it('custom expands {description} into the full Plan prompt', () => {
    const built = buildAgentCommand(makeAgentConfig({ tool: 'custom', command: 'agent {description}' }), planPath, description, title, agentName);
    assert.equal(built.command, 'agent');
    // The custom command is split on spaces (unchanged behaviour), so the prompt
    // is asserted by rejoining the args.
    assert.equal(built.args.join(' '), `[${agentName}] ${description}\n\nPlan: ${title}\nWork in: ${planDir}`);
  });

  it('custom treats a missing/undefined plan path as the process working directory', () => {
    const built = buildAgentCommand(makeAgentConfig({ tool: 'custom', command: 'echo {plan_dir}' }), 'undefined', description, title, agentName);
    assert.equal(built.command, 'echo');
    assert.deepEqual(built.args, [process.cwd()]);
  });

  it('sanitizeBranchName still produces the same slug', () => {
    assert.equal(sanitizeBranchName('feat/Plan 001'), 'feat-plan-001');
  });
});
