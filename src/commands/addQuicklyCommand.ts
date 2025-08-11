import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

function insertTaskLinkUnderSection(content: string, section: string, taskLink: string): string {
  const sectionRegex = new RegExp(`(^|\n)## ${section}[^\n]*\n`, 'i');
  const match = content.match(sectionRegex);
  if (match) {
    // Section exists, insert after section header
    const insertPos = match.index! + match[0].length;
    // Find where the next section starts or end of file
    const nextSection = content.slice(insertPos).search(/^## /m);
    if (nextSection === -1) {
      // No next section, append at end
      const before = content.slice(0, insertPos);
      const after = content.slice(insertPos);
      // Avoid duplicate
      if (after.includes(taskLink)) return content;
      return before + (after.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    } else {
      // Insert before next section
      const before = content.slice(0, insertPos + nextSection);
      const after = content.slice(insertPos + nextSection);
      if (before.includes(taskLink)) return content;
      return before + (before.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    }
  } else {
    // Section does not exist, add it at the end
    if (content.includes(taskLink)) return content;
    return content.trimEnd() + `\n\n## ${section}\n${taskLink}\n`;
  }
}

export function registerAddQuicklyCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('sprintdesk.addQuickly', async () => {
    const input = await vscode.window.showInputBox({
      prompt: "Enter: '@task task name @epic epic name @backlog backlog name'",
      placeHolder: "@task My Task @epic My Epic @backlog My Backlog"
    });
    if (!input) {
      return;
    }

    // Parse input
    const taskMatch = input.match(/@task ([^@]+)/);
    const epicMatch = input.match(/@epic ([^@]+)/);
    const backlogMatch = input.match(/@backlog ([^@]+)/);
    const taskName = taskMatch ? taskMatch[1].trim() : undefined;
    const epicName = epicMatch ? epicMatch[1].trim() : undefined;
    const backlogName = backlogMatch ? backlogMatch[1].trim() : undefined;

    if (!taskName) {
      vscode.window.showErrorMessage('Task name (@task) is required.');
      return;
    }

    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const root = workspaceFolders[0].uri.fsPath;
    const sprintDeskPath = path.join(root, '.SprintDesk');

    // Ensure folders exist
    const tasksDir = path.join(sprintDeskPath, 'tasks');
    const epicsDir = path.join(sprintDeskPath, 'epics');
    const backlogDir = path.join(sprintDeskPath, 'backlogs');
    [tasksDir, epicsDir, backlogDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Create task file name
    let taskFileName = `[Task]_${taskName.replace(/\s+/g, '-')}`;
    if (epicName) {
      taskFileName += `_[Epic]_${epicName.replace(/\s+/g, '-')}`;
    }
    taskFileName += '.md';
    const taskFilePath = path.join(tasksDir, taskFileName);
    if (!fs.existsSync(taskFilePath)) {
      fs.writeFileSync(taskFilePath, `# Task: ${taskName}\n${epicName ? `Epic: ${epicName}\n` : ''}`);
    }

    // Add to epic if specified
    if (epicName) {
      const epicFileName = `[Epic]_${epicName.replace(/\s+/g, '-')}.md`;
      const epicFilePath = path.join(epicsDir, epicFileName);
      let epicContent = '';
      if (fs.existsSync(epicFilePath)) {
        epicContent = fs.readFileSync(epicFilePath, 'utf8');
      } else {
        epicContent = `# Epic: ${epicName}\n`;
      }
      // Link to task (relative path)
      const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${taskFileName})`;
      epicContent = insertTaskLinkUnderSection(epicContent, 'tasks', taskLink);
      fs.writeFileSync(epicFilePath, epicContent);
    }

    // Add to backlog if specified
    if (backlogName) {
      // Find backlog file by partial match
      const backlogFiles = fs.readdirSync(backlogDir).filter(f => f.toLowerCase().includes(backlogName.toLowerCase()));
      if (backlogFiles.length === 0) {
        vscode.window.showErrorMessage(`No backlog file found matching '${backlogName}'.`);
      } else {
        const backlogFilePath = path.join(backlogDir, backlogFiles[0]);
        let backlogContent = fs.readFileSync(backlogFilePath, 'utf8');
        // Link to task (relative path)
        const taskLink = `- 📌 [${taskName.replace(/\s+/g, '-').toLowerCase()}](../tasks/${taskFileName})`;
        backlogContent = insertTaskLinkUnderSection(backlogContent, 'tasks', taskLink);
        fs.writeFileSync(backlogFilePath, backlogContent);
      }
    }

    vscode.window.showInformationMessage('Task created and linked successfully!');
  });

  context.subscriptions.push(disposable);
}
