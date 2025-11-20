---
_id: 17
title: add-sprint
type: feature
category: sprint
component: sprint
duration: 0.5d
priority: high
status: waiting
assignee: unassigned
created_at: 2025-11-20T18:14:30.000Z
updated_at: 2025-11-20T18:14:30.000Z
objective: Implement `addSprint` command to create new sprint files and metadata.
path: '../Tasks/[Task-17]_add-sprint.md'
sprints: null
backlogs: null
related_tasks: null
tags: null
epic:
  _id: 4
  title: sprints management
  status: planned
  priority: high
  createdAt: '2025-11-20T18:14:00.000Z'
  updatedAt: '2025-11-20T18:14:00.000Z'
  totalTasks: 4
  completedTasks: 0
  path: '../Epics/[Epic-4]_sprints-management.md'
---


# 🗂️ Task: add sprint

📘 Epic: `sprints management`


## 🗂️ Overview
| Field | Value |
|:--|:--|
| 🧠 **Type** | feature |
| 🧩 **Category** | Sprint |
| ⚙️ **Component** | Sprint |
| ⏱️ **Duration** | 0.5d |
| 🚦 **Priority** | high |
| 📊 **Status** | waiting |
| 👤 **Assignee** | Unassigned |
| 🕓 **Created At** | 2025-11-20T18:14:30.000Z |
| 🔄 **Updated At** | 2025-11-20T18:14:30.000Z |
| 🎯 **Objective** | Implement `addSprint` command to create new sprint files and metadata. |


## 🧱 Description
Command to create a new sprint markdown file under `.SprintDesk/Sprints`, populate frontmatter and update any indexes.


## ✅ Acceptance Criteria
- [ ] Create sprint file with frontmatter and proper path
- [ ] Add sprint to any index or register used by the extension


## 🧱 Epic
| # | Epic | Status | Priority | File |
|:--|:----|:------:|:--------:|:-----|
| 1 | [sprints management](../Epics/[Epic-4]_sprints-management.md) | planned | high | `4` |
