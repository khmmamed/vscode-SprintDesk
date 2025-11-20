import { EPIC_CONSTANTS, PROJECT_CONSTANTS, UI_CONSTANTS } from './constant';

export function generateEpicId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `epic_${slug}`;
}
export function generateEpicName(title: string): string {
  const epicSlug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epicSlug}.md`;
}
export function generateEpicMetadata(metadata: SprintDesk.EpicMetadata): string {
  const epicName = metadata.title.replace(/[^\w\s-]/g, '');
  const now = new Date().toISOString();
  const startDate = metadata.startDate?.toISOString() || now;

  return `---
_id: ${metadata._id}
title: ${epicName}
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
path: ${metadata.path || ''}
backlogs:

sprints:

tasks:

related_epics:
---
`;
}
export function generateEpicContent(metadata: SprintDesk.EpicMetadata): string {
  const now = new Date().toISOString();
  const startDate = metadata.startDate?.toISOString() || now;

  return `
# 🌟 Epic: ${metadata.title}

## 📘 Description
${metadata.description || 'Add detailed epic description here...'}

## 📊 Overview
- 🕓 **Created At:** ${startDate}
- 🔄 **Updated At:** ${now}
- 📌 **Total Tasks:** ${metadata.totalTasks || 0}
- 📈 **Status:** ${metadata.status || EPIC_CONSTANTS.STATUS.PLANNED} [${metadata.completedTasks || 0}/${metadata.totalTasks || 0} Complete]
- 🎨 **Color:** ${metadata.color || '#0b2cc2'}

## 🧠 Notes
Add implementation notes here...

## Backlogs
[Backlogs will be linked here automatically]

## Sprints
[Sprints will be linked here automatically]

## Tasks

| # | Task | Status | Priority | File |
|:--|:-----|:------:|:--------:|:-----|
<!-- Tasks will be added here automatically -->

## Related Epics
[Related epics will be linked here automatically]

`;
}

export function generateEpicTemplate(metadata: SprintDesk.EpicMetadata): string {
  const epicMetadata = generateEpicMetadata(metadata);
  const epicContent = generateEpicContent(metadata);
  return `${epicMetadata}\n${epicContent}`;
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