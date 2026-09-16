import * as vscode from 'vscode';
import { WorkforceTreeDataProvider, WorkforceItem } from '../../providers/workforce/WorkforceTreeDataProvider';
import * as workforceService from '../../services/workforce/workforceService';
import * as queueService from '../../services/workforce/queueService';
import * as worker from '../../services/workforce/worker/worker';
import { getStores } from '../../data/stores';
import { openWorkforceControlCenter } from './openWorkforceControlCenter';

export function registerWorkforceCommands(context: vscode.ExtensionContext, provider: WorkforceTreeDataProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.viewWorkforce', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.syncPeopleFromGit', async () => {
      const added = await workforceService.syncPeopleFromGit();
      provider.refresh();
      vscode.window.showInformationMessage(added > 0
        ? `People synced: ${added} human(s) added from Git`
        : 'People are up to date with Git');
    }),

    vscode.commands.registerCommand('sprintdesk.addEmployee', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter employee name' });
      if (!name) return;

      const rolePick = await vscode.window.showQuickPick(
        [
          { label: 'Human', description: 'A person on the team', value: 'human' as const },
          { label: 'Agent', description: 'An AI worker', value: 'agent' as const }
        ],
        { placeHolder: 'Select role' }
      );
      if (!rolePick) return;

      const skills = await vscode.window.showQuickPick(
        (() => {
          getStores().skills.seedDefaultSkills();
          return getStores().skills.loadAll().map(s => ({
            label: s.name,
            description: s.category || undefined,
            detail: s.description,
            value: s.name
          }));
        })(),
        { canPickMany: true, placeHolder: 'Select skills from catalog (optional)' }
      );

      const workforce = workforceService.getWorkforce();
      const teamPick = await vscode.window.showQuickPick(
        [
          { label: 'Unassigned', value: undefined as string | undefined },
          ...workforce.teams.map(t => ({ label: t.name, value: t.id }))
        ],
        { placeHolder: 'Assign to team (optional)' }
      );

      const employee = workforceService.addEmployee({
        name,
        role: rolePick.value,
        skills: skills ? skills.map(s => ({ name: s.value, level: 1 as const })) : [],
        teamId: teamPick?.value
      });

      provider.refresh();
      vscode.window.showInformationMessage(`Person ${employee.name} added`);
    }),

    vscode.commands.registerCommand('sprintdesk.createTeam', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter team name' });
      if (!name) return;

      const description = await vscode.window.showInputBox({ prompt: 'Team description (optional)' });
      workforceService.createTeam({ name, description: description || undefined });

      provider.refresh();
      vscode.window.showInformationMessage(`Team ${name} created`);
    }),

    vscode.commands.registerCommand('sprintdesk.assignToTeam', async (item: WorkforceItem) => {
      const allEmployees = workforceService.getWorkforce().employees;
      let employee = item?.employee;
      const source = item?.employee
        ? `Assigned to ${item.team?.name || 'Unassigned'}`
        : undefined;

      if (!employee) {
        const flatItems = allEmployees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee to assign' });
        if (!picked) return;
        employee = picked.employee;
      }

      if (!employee) return;
      const targetEmployee = employee;

      const teams = workforceService.getWorkforce().teams;
      const current = teams.find(t => t.memberIds.includes(targetEmployee.id));
      const target = await vscode.window.showQuickPick([
        { label: 'Unassign', description: current ? `Leave ${current.name}` : 'Currently unassigned', value: undefined as string | undefined },
        ...teams.map(t => ({ label: t.name, description: current?.id === t.id ? 'Current team' : undefined, value: t.id }))
      ], { placeHolder: source || 'Select target team' });

      if (target === undefined && current) {
        workforceService.removeFromTeam(targetEmployee.id);
      } else if (target?.value) {
        if (current?.id === target.value) return;
        workforceService.assignToTeam(targetEmployee.id, target.value);
      } else {
        return;
      }

      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.setTeamLead', async (item: WorkforceItem) => {
      if (!item?.team) return;

      const team = item.team;
      const memberPick = await vscode.window.showQuickPick(
        team.memberIds.map(id => {
          const e = workforceService.getWorkforce().employees.find(emp => emp.id === id);
          return { label: e?.name || id, description: team.leadId === id ? 'Current lead' : undefined, value: id };
        }),
        { placeHolder: `Set lead for ${team.name}` }
      );
      if (!memberPick) return;

      workforceService.setTeamLead(team.id, memberPick.value);
      provider.refresh();
      vscode.window.showInformationMessage(`Lead updated for ${team.name}`);
    }),

    vscode.commands.registerCommand('sprintdesk.setEmployeeStatus', async (item: WorkforceItem) => {
      const employees = workforceService.getWorkforce().employees;
      const employee = item?.employee || (await (async () => {
        const flatItems = employees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee' });
        return picked?.employee;
      })());
      if (!employee) return;

      const status = await vscode.window.showQuickPick(
        [
          { label: 'Idle', value: 'idle' as const },
          { label: 'Busy', value: 'busy' as const },
          { label: 'Offline', value: 'offline' as const }
        ],
        { placeHolder: `Set availability for ${employee.name} (current: ${employee.status || 'idle'})` }
      );
      if (!status) return;

      workforceService.setEmployeeStatus(employee.id, status.value);
      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.createTaskForEmployee', async (item: WorkforceItem) => {
      const employee = item?.employee || (await (async () => {
        const agents = workforceService.getWorkforce().employees.filter(e => e.role === 'agent');
        const picked = await vscode.window.showQuickPick(
          agents.map(e => ({ label: e.name, description: `${e.status || 'idle'} · ${(e.capabilities || []).join(', ') || 'no capabilities'}`, employee: e })),
          { placeHolder: 'Select an agent' }
        );
        return picked?.employee;
      })());
      if (!employee) return;
      openWorkforceControlCenter('create-input', employee.id);
    }),

    vscode.commands.registerCommand('sprintdesk.cancelRun', async (item: WorkforceItem) => {
      const run = item?.run;
      if (!run) return;
      const confirm = await vscode.window.showWarningMessage(
        `Cancel run for "${item.label}"?`,
        { modal: true },
        'Cancel Run'
      );
      if (confirm !== 'Cancel Run') return;
      try {
        queueService.cancelRun(run.id);
        provider.refresh();
        vscode.window.showInformationMessage(`Run ${run.id} cancelled`);
      } catch (e: any) {
        vscode.window.showErrorMessage(e.message || String(e));
      }
    }),

    vscode.commands.registerCommand('sprintdesk.processQueue', async () => {
      const current = queueService.getQueueSettings().workerMode;
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Headless', description: 'Run agents as background processes (default)', value: 'headless' as const },
          { label: 'VS Code terminal', description: 'Run agents in the integrated terminal', value: 'terminal' as const },
          { label: 'Ollama (LLM)', description: 'Execute the task via the employee model profile', value: 'ollama' as const },
          { label: 'Noop (dry-run)', description: 'Record runs as completed without a real agent', value: 'noop' as const }
        ],
        { placeHolder: `Worker mode for this pass (current: ${current})` }
      );
      const mode = pick?.value || current;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'SprintDesk: processing queue…' },
        async () => {
          const result = await worker.runQueuePass({ mode });
          const ok = result.executed.filter(e => e.result?.status === 'completed').length;
          const failed = result.executed.length - ok;
          const summary =
            `Queue pass (${mode}): ${result.claims.length} claimed · ${result.executed.length} executed ` +
            `(${ok} ok, ${failed} failed) · ${result.skipped.length} skipped`;
          if (failed > 0) {
            vscode.window.showWarningMessage(summary);
          } else {
            vscode.window.showInformationMessage(summary);
          }
          provider.refresh();
        }
      );
    }),

    vscode.commands.registerCommand('sprintdesk.removeEmployee', async (item: WorkforceItem) => {
      const employees = workforceService.getWorkforce().employees;
      const employee = item?.employee || (await (async () => {
        const flatItems = employees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee to remove' });
        return picked?.employee;
      })());
      if (!employee) return;

      const confirm = await vscode.window.showWarningMessage(
        `Remove employee "${employee.name}" from the workforce?`,
        { modal: true },
        'Remove'
      );
      if (confirm !== 'Remove') return;

      workforceService.removeEmployee(employee.id);
      provider.refresh();
      vscode.window.showInformationMessage(`Employee ${employee.name} removed from workforce`);
    })
  );
}
