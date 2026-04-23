import * as vscode from 'vscode';

export async function promptInput(prompt: string, placeHolder?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt, placeHolder });
}

export function removeEmojiFromTaskLabel(label: string): string {
  return label.replace(/\p{Extended_Pictographic}/gu, '').trim();
}

export function insertTaskLinkUnderSection(content: string, section: string, taskLink: string): string {
  const sectionRegex = new RegExp(`(^|\n)##\\s*${section}[^\\n]*\\n`, 'i');
  const match = content.match(sectionRegex);
  if (match) {
    const insertPos = match.index! + match[0].length;
    const nextSection = content.slice(insertPos).search(/^##\s+/m);
    if (nextSection === -1) {
      const before = content.slice(0, insertPos);
      const after = content.slice(insertPos);
      if (after.includes(taskLink)) return content;
      return before + (after.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    } else {
      const before = content.slice(0, insertPos + nextSection);
      const after = content.slice(insertPos + nextSection);
      if (before.includes(taskLink)) return content;
      return before + (before.endsWith('\n') ? '' : '\n') + taskLink + '\n' + after;
    }
  } else {
    if (content.includes(taskLink)) return content;
    return content.trimEnd() + `\n\n## ${section}\n${taskLink}\n`;
  }
}

export { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS, COMMON_EMOJI, STATUS_EMOJI, PRIORITY_EMOJI } from './constant';