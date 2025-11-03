import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EPIC_CONSTANTS, PROJECT_CONSTANTS } from './constant';

function getPriorityEmoji(priority?: Priority): string {
  switch (priority?.toLowerCase()) {
    case 'high':
      return '🟢';
    case 'low':
      return '🔴';
    default:
      return '🟡';
  }
}

type TaskType = 'feature' | 'bug' | 'improvement' | 'documentation' | 'test';
type TaskStatus = 'not-started' | 'in-progress' | 'done' | 'blocked';
type Priority = 'high' | 'medium' | 'low';

interface TaskMetadata {
  title: string;
  type?: TaskType;
  category?: string;
  component?: string;
  duration?: string;
  priority?: Priority;
  status?: TaskStatus;
  assignee?: string;
  epicId?: string;
  epicName?: string;
}

type EpicStatus = '⏳ Planned' | '🔄 In Progress' | '✅ Completed' | '⛔ Blocked';

interface EpicMetadata {
  title: string;
  type?: string;
  description?: string;
  priority?: Priority;
  status?: EpicStatus;
  owner?: string;
  color?: string;
  startDate?: Date;
  endDate?: Date;
  totalTasks?: number;
  completedTasks?: number;
  progress?: string;
}

export function generateTaskId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `tsk_${slug}`;
}

export function generateEpicId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `epic_${slug}`;
}

export function generateTaskContent(metadata: SprintDesk.TaskMetadata): string {
  const taskId = generateTaskId(metadata.title);
  const taskName = metadata.title.replace(/[^\w\s-]/g, '');
  const now = new Date().toISOString();
  
  return `---
_id: ${taskId}
name: ${taskName.toLowerCase().replace(/\s+/g, '-')}
type: ${metadata.type || 'feature'}
category: ${metadata.category || 'uncategorized'}
component: ${metadata.component || 'general'}
duration: ${metadata.duration || '0d'}
priority: ${metadata.priority || 'medium'}
status: ${metadata.status || 'not-started'}
assignee: ${metadata.assignee || 'unassigned'}
created_at: ${now}
updated_at: ${now}
objective: ${metadata.title}
${metadata.epicId && metadata.epicName ? `epic:
  _id: ${metadata.epicId}
  name: ${metadata.epicName}
  file: ../epics/${generateEpicFileName(metadata.epicName)}` : ''}
sprints: []
backlogs: []
related_tasks: []
tags: []
---

# 🧩 Task: ${taskName}
${metadata.epicName ? `📘 Epic: \`${metadata.epicName}\`` : ''}

---

## 🗂️ Overview
| Field | Value |
|:--|:--|
| 🧠 **Type** | ${metadata.type || 'Feature'} |
| 🧩 **Category** | ${metadata.category || 'Uncategorized'} |
| ⚙️ **Component** | ${metadata.component || 'General'} |
| ⏱️ **Duration** | ${metadata.duration || '0d'} |
| 🚦 **Priority** | ${getPriorityEmoji(metadata.priority)} ${metadata.priority || 'Medium'} |
| 📊 **Status** | ${metadata.status || '⏳ Not Started'} |
| 👤 **Assignee** | ${metadata.assignee || 'Unassigned'} |
| 🕓 **Created At** | ${now} |
| 🔄 **Updated At** | ${now} |
| 🎯 **Objective** | ${metadata.title}

---

## 🧱 Description
Add task description here...

---

## ✅ Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

---

## 📋 Checklist
- [ ] Task 1
- [ ] Task 2

${metadata.epicName ? `
## Epic
- [${metadata.epicName}](../epics/${generateEpicFileName(metadata.epicName)})
` : ''}

## Sprints
[Sprints will be linked here automatically]

## Backlogs
[Backlogs will be linked here automatically]

## Related Tasks
[Related tasks will be linked here automatically]

---

## 🧠 Notes
Add implementation notes here...
`;
}

export function generateEpicContent(metadata: SprintDesk.EpicMetadata): string {
  const epicId = generateEpicId(metadata.title);
  const epicName = metadata.title.replace(/[^\w\s-]/g, '');
  const now = new Date().toISOString();
  const startDate = metadata.startDate?.toISOString() || now;
  const endDate = metadata.endDate?.toISOString() || now;

  return `---
_id: ${epicId}
name: ${epicName}
color: "#0b2cc2"
description: ${metadata.description || 'Add epic description here...'}
status: ${metadata.status || '⏳ Planned'}
created_at: ${startDate}
updated_at: ${now}
totalTasks: 0
completedTasks: 0
waitingTasks: 0
startedTasks: 0
doneTasks: 0
progress: 0%

# Related Backlogs (many-to-one)
backlogs:

# Related Sprints (many-to-one)
sprints:

# Tasks List
tasks:
  # Format: array of task objects
  # - _id: task_id
  #   name: task_name
  #   status: task_status
  #   priority: task_priority
  #   file: relative_path_to_task_file

# Related Epics (many-to-many)
related_epics:
---

# 🌟 Epic: ${epicName}

## 📘 Description
${metadata.description || 'Add detailed epic description here...'}

## 📊 Overview
- 🕓 **Created At:** ${startDate}
- 🔄 **Updated At:** ${now}
- 📌 **Total Tasks:** ${metadata.totalTasks || 0}
- 📈 **Status:** ${metadata.status || EPIC_CONSTANTS.STATUS.PLANNED} [${metadata.completedTasks || 0}/${metadata.totalTasks || 0} Complete]
- 🎨 **Color:** ${metadata.color || '#0b2cc2'}

## Backlogs
[Backlogs will be linked here automatically]

## Sprints
[Sprints will be linked here automatically]

## 🧱 Tasks

| # | Task | Status | Priority | File |
|:--|:-----|:------:|:--------:|:-----|
<!-- Tasks will be added here automatically -->

## Related Epics
[Related epics will be linked here automatically]

---

## 🧠 Notes
Add implementation notes here...
`;
}

export function generateTaskFileName(title: string, epicName?: string): string {
  const taskId = generateTaskId(title);
  const taskSlug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (epicName) {
    const epicSlug = epicName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${taskId}_${taskSlug}_${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epicSlug}.md`;
  }
  return `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${taskId}_${taskSlug}.md`;
}

export function generateEpicFileName(title: string): string {
  const epicSlug = title.replace(/\s+/g, '-');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epicSlug}.md`;
}

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

export function parseEpicMetadataFromFilename(filename: string): { epicName: string } {
  const epicPrefix = PROJECT_CONSTANTS.FILE_PREFIX.EPIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${epicPrefix}(.+?)\.md$`);
  const match = filename.match(pattern);
  if (!match) throw new Error('Invalid epic filename format');
  
  return {
    epicName: match[1].replace(/-/g, ' ')
  };
}