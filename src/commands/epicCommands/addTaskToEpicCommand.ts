import * as vscode from 'vscode';
import * as fs from 'fs';
import matter from 'gray-matter';
import * as path from 'path';

export function registerAddTaskToEpicCommand(context: vscode.ExtensionContext, deps?: { epicsProvider?: any; tasksProvider?: any }) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.addTaskToEpic', async (params: {
      epicId: string,
      epicPath: string,
      taskId: string,
      taskPath: string
    }) => {
      try {
        if (!fs.existsSync(params.epicPath) || !fs.existsSync(params.taskPath)) {
          throw new Error('Epic or task file not found');
        }

        const epicContent = fs.readFileSync(params.epicPath, 'utf8');
        const epicMatter = matter(epicContent);

        const taskContent = fs.readFileSync(params.taskPath, 'utf8');
        const taskMatter = matter(taskContent);

        if (!Array.isArray(epicMatter.data.tasks)) {
          epicMatter.data.tasks = [];
        }

        const taskData = {
          _id: params.taskId,
          name: taskMatter.data.title || taskMatter.data.name,
          status: taskMatter.data.status || 'not-started',
          file: path.relative(path.dirname(params.epicPath), params.taskPath).replace(/\\/g, '/'),
          description: taskMatter.data.description || '',
          priority: taskMatter.data.priority || 'medium'
        };

        const existingTaskIndex = epicMatter.data.tasks.findIndex((t: any) => t._id === params.taskId);
        if (existingTaskIndex >= 0) {
          epicMatter.data.tasks[existingTaskIndex] = taskData;
        } else {
          epicMatter.data.tasks.push(taskData);
        }

        epicMatter.data.total_tasks = epicMatter.data.tasks.length;
        epicMatter.data.completed_tasks = epicMatter.data.tasks
          .filter((t: any) => t.status === 'done' || t.status === 'completed').length;
        epicMatter.data.progress = Math.round((epicMatter.data.completed_tasks / epicMatter.data.total_tasks) * 100) + '%';

        const taskTableHeader = `| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|`;

        const taskListSection = epicMatter.data.tasks
          .map((task: any, index: number) => {
            const statusEmoji = getTaskStatusEmoji(task.status);
            const priorityEmoji = getPriorityEmoji(task.priority);
            return `| ${index + 1} | [${task.name}](${task.file}) | ${statusEmoji} ${task.status} | ${priorityEmoji} ${task.priority} | \`${task._id}\` |`;
          })
          .join('\n');

        const taskTable = `${taskTableHeader}\n${taskListSection}\n<!-- Tasks will be added here automatically -->`;

        const tasksSectionMarker = '## 🧱 Tasks';
        const tasksStart = epicMatter.content.indexOf(tasksSectionMarker);
        if (tasksStart !== -1) {
          const tableStart = epicMatter.content.indexOf('| # | Task |', tasksStart);
          const nextSectionMatch = epicMatter.content.slice(tasksStart).match(/\n##\s/);
          const tasksEnd = nextSectionMatch && nextSectionMatch.index !== undefined
            ? tasksStart + nextSectionMatch.index
            : epicMatter.content.length;

          epicMatter.content =
            epicMatter.content.slice(0, tasksStart) +
            `${tasksSectionMarker}\n\n${taskTable}\n\n` +
            epicMatter.content.slice(tasksEnd);
        }

        function getTaskStatusEmoji(status: string): string {
          switch (status?.toLowerCase()) {
            case 'not-started': return '⏳';
            case 'in-progress': return '🔄';
            case 'done':
            case 'completed': return '✅';
            case 'blocked': return '⛔';
            default: return '⏳';
          }
        }

        function getPriorityEmoji(priority: string): string {
          switch (priority?.toLowerCase()) {
            case 'high': return '🔴';
            case 'low': return '🟢';
            default: return '🟡';
          }
        }

        taskMatter.data.epic = {
          _id: params.epicId,
          name: epicMatter.data.title || epicMatter.data.name,
          file: path.relative(path.dirname(params.taskPath), params.epicPath).replace(/\\/g, '/')
        };

        fs.writeFileSync(params.epicPath, matter.stringify(epicMatter.content, epicMatter.data));
        fs.writeFileSync(params.taskPath, matter.stringify(taskMatter.content, taskMatter.data));

        vscode.window.showInformationMessage(`Added task to epic "${epicMatter.data.title || epicMatter.data.name}"`);
        deps?.epicsProvider?.refresh?.();
        deps?.tasksProvider?.refresh?.();
      } catch (error) {
        vscode.window.showErrorMessage('Failed to add task to epic: ' + (error as Error).message);
      }
    })
  );
}
