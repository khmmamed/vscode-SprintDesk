import * as path from 'path';

import { PROJECT_CONSTANTS, UI_CONSTANTS } from './constant';
import { generateEpicName } from './epicTemplate';
import { get } from 'http';

export function generateTaskId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `tsk_${slug}`;
}

export function generateEpicId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `epic_${slug}`;
}

export function getTaskName(title: string): string {
  const taskSlug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${taskSlug}`;
}
export function generateTaskFile(title: string, epicTitle?: string): string {
  return `${getTaskName(title)}.md`;
}

export const generateTaskMetadata = (metadata: SprintDesk.TaskMetadata): string => {
  const now = new Date().toISOString();
  const taskId = generateTaskId(metadata.title);
  const epicName = metadata.epicTitle ? `${generateEpicName(metadata.epicTitle)}` : '';
  const taskName = metadata.epicTitle ?
    `[Task]_${metadata.title.toLowerCase().replace(/\s+/g, '-')}_${generateEpicName(metadata.epicTitle)}` :
    `[Task]_${metadata.title.toLowerCase().replace(/\s+/g, '-')}.md`
  console.log('Generating task metadata for ID:', taskId);
  return `---
_id: ${taskId}
title: ${metadata.title.toLowerCase().replace(/\s+/g, '-')}
type: ${metadata.type || 'feature'}
category: ${metadata.category || 'uncategorized'}
component: ${metadata.component || 'general'}
duration: ${metadata.duration || '0d'}
priority: ${metadata.priority || 'medium'}
status: ${metadata.status || 'waiting'}
assignee: ${metadata.assignee || 'unassigned'}
created_at: ${now}
updated_at: ${now}
objective: ${metadata.objective || 'Add task objective here...'}
path: ../tasks/${taskName}
${metadata.epicId && metadata.epicTitle ? `epic:
  _id: ${metadata.epicId}
  title: ${metadata.epicTitle}
  path: ../${PROJECT_CONSTANTS.EPICS_DIR}/${epicName}` : ''}
sprints: 
backlogs: 
related_tasks: 
tags: 
---`
};
export const generateTaskContent = (metadata: SprintDesk.TaskMetadata): string => {
  const now = new Date().toISOString();
  return `
# 🧩 Task: ${metadata.title}
${metadata.epicTitle ? `📘 Epic: \`${metadata.epicTitle}\`` : ''}


## 🗂️ Overview
| Field | Value |
|:--|:--|
| 🧠 **Type** | ${metadata.type || 'Feature'} |
| 🧩 **Category** | ${metadata.category || 'Uncategorized'} |
| ⚙️ **Component** | ${metadata.component || 'General'} |
| ⏱️ **Duration** | ${metadata.duration || '0d'} |
| 🚦 **Priority** | ${metadata.priority || UI_CONSTANTS.EMOJI.PRIORITY.MEDIUM} |
| 📊 **Status** | ${metadata.status || '⏳ Not Started'} |
| 👤 **Assignee** | ${metadata.assignee || 'Unassigned'} |
| 🕓 **Created At** | ${now} |
| 🔄 **Updated At** | ${now} |
| 🎯 **Objective** | ${metadata.objective || 'Add task objective here...'} |


## 🧱 Description
Add task description here...


## ✅ Acceptance Criteria
- [ ] Criterion 1


## 📋 Checklist
- [ ] Task 1

## 🧠 Notes
> Add implementation notes here...
${metadata.epicTitle ? `
## Epic
- [${metadata.epicTitle}](../${PROJECT_CONSTANTS.EPICS_DIR}/${generateEpicName(metadata.epicTitle)})
` : ''}

## Sprints
> Sprints will be linked here automatically

## Backlogs
> Backlogs will be linked here automatically

## Related Tasks
> Related tasks will be linked here automatically
 `};
export function generateTaskTemplate(metadata: SprintDesk.TaskMetadata): string {

  return `${generateTaskMetadata(metadata)}

${generateTaskContent(metadata)}
`;
}

// Update epic line after task header
export const updateEpicHeaderLine = (ls: string[], epicMeta: SprintDesk.EpicMetadata): string[] => {
  const taskHeaderIdx = ls.findIndex(l => l.trim().startsWith('# 🧩 Task'));
  if (taskHeaderIdx === -1) return [`📘 Epic: \`${epicMeta.title}\``, ...ls];

  const afterTask = taskHeaderIdx + 1;
  return ls.map((line, i) =>
    i === afterTask && line.trim().startsWith('📘 Epic:')
      ? `📘 Epic: \`${epicMeta.title}\``
      : i === afterTask && !line.trim().startsWith('📘 Epic:')
        ? [line, `📘 Epic: \`${epicMeta.title}\``]
        : line
  ).flat();
};

// Update epic section
export const updateEpicSection = (ls: string[], epicMeta: SprintDesk.EpicMetadata): string[] => {
  const secIdx = ls.findIndex(l => l.trim() === '## Epic');
  const link = `- [${epicMeta.title}](${epicMeta.path})`;

  if (secIdx === -1) {
    // If no "## Epic" section, append it at the end
    return [...ls, '## Epic', link];
  }

  // Keep lines before the section, replace everything after with the new link
  const before = ls.slice(0, secIdx + 1); // include the '## Epic' line
  return [...before, link];
};



/* 
 * Old code for reference:
*/
export function parseTaskMetadataFromFilename(filename: string): { taskName: string; epicName?: string } {
  const taskPrefix = PROJECT_CONSTANTS.FILE_PREFIX.TASK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const epicPrefix = PROJECT_CONSTANTS.FILE_PREFIX.EPIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${taskPrefix}(.+?)(?:_${epicPrefix}(.+?))?\.md$`);
  const match = filename.match(pattern);
  if (!match) throw new Error('Invalid task filename format');

  return {
    taskName: match[1].replace(/-/g, ' '),
    epicName: match[2]?.replace(/-/g, ' ')
  };
}
