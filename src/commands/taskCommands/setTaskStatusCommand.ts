import * as vscode from 'vscode';
import * as taskService from '../../services/taskService';
import { getWorkspaceRoot } from '../../services/fileService';

function execCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(command, { cwd }, (err: Error | null, stdout: string, stderr: string) => {
      resolve({ stdout, stderr });
    });
  });
}

async function stageCommitForReview(taskCode: string, taskTitle: string, ws: string): Promise<void> {
  try {
    await execCommand('git add -A', ws);
    await execCommand(`git commit -m "Review: ${taskCode} - ${taskTitle}"`, ws);
    vscode.window.showInformationMessage(`Committed changes for review: ${taskCode}`);
  } catch (error) {
    vscode.window.showWarningMessage(`Could not commit: ${error}`);
  }
}

async function mergeAndCleanupBranch(taskCode: string, memberName: string, ws: string, developBranch: string): Promise<boolean> {
  const branchName = `agent/${memberName}/${taskCode}`;

  try {
    await execCommand(`git checkout ${developBranch}`, ws);
    
    const mergeResult = await execCommand(`git merge ${branchName} --no-ff`, ws);
    
    if (mergeResult.stderr.includes('conflict') || mergeResult.stdout.includes('conflict')) {
      vscode.window.showWarningMessage(`Merge conflict in branch '${branchName}'. Resolve manually and delete branch when done.`);
      return false;
    }
    
    await execCommand(`git branch -d ${branchName}`, ws);
    vscode.window.showInformationMessage(`Merged and cleaned up branch: ${branchName}`);
    return true;
  } catch (error) {
    vscode.window.showWarningMessage(`Could not merge branch: ${error}. Resolve manually and delete branch when done.`);
    return false;
  }
}

function getDevelopBranch(ws: string): string {
  try {
    const dataService = require('../../data/DataService').getDataService(ws);
    const config = dataService.loadConfig();
    return config?.developBranch || 'develop';
  } catch {
    return 'develop';
  }
}

export function registerSetTaskStatusCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.setTaskStatus', async (item: any, status: string) => {
      if (!item || !item.label) {
        vscode.window.showWarningMessage('No task selected');
        return;
      }

      const taskCode = item.label.split(':')[0].trim();
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) return;

      const dataService = taskService.getTaskService(ws);
      const tasks = dataService.loadTasks();
      const task = tasks.find(t => t.code === taskCode);
      
      if (!task) {
        vscode.window.showWarningMessage('Task not found');
        return;
      }

      const memberId = task.assignee;
      
      taskService.setTaskStatus(task.id, status as any);
      
      if (status === 'done' && memberId) {
        const teamService = require('../../services/team/teamService');
        const teamMember = teamService.getTeamMember(memberId);
        const memberName = teamMember?.name || 'unknown';
        
        const developBranch = getDevelopBranch(ws);
        
        await mergeAndCleanupBranch(taskCode, memberName, ws, developBranch);
      }
      
      vscode.window.showInformationMessage(`Task ${task.code} status: ${status}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.markTaskForReview', async (item: any) => {
      if (!item || !item.label) {
        vscode.window.showWarningMessage('No task selected');
        return;
      }

      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) return;

      const taskCode = item.label.split(':')[0].trim();
      const dataService = taskService.getTaskService(ws);
      const tasks = dataService.loadTasks();
      const task = tasks.find(t => t.code === taskCode);
      
      if (!task) {
        vscode.window.showWarningMessage('Task not found');
        return;
      }

      await stageCommitForReview(taskCode, task.title, ws);
      taskService.setTaskStatus(task.id, 'review');
      vscode.window.showInformationMessage(`Task ${task.code} marked for review`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.completeTask', async (item: any) => {
      await vscode.commands.executeCommand('sprintdesk.setTaskStatus', item, 'done');
    })
  );
}