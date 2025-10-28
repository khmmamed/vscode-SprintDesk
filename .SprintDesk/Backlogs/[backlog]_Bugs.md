---
_id: backlog_bugs_001
name: Bugs Backlog
status: planned
priority: high
type: bugs_backlog
created_at: 2025-10-28
updated_at: 2025-10-28
owner: Khmamid Meddd

# Related Epics (many-to-many)
epics:
  epic_pdp_core_01:
    _id: epic_pdp_core_01
    name: PDP Core
    file: ../epics/[Epic]_pdp-core-01.md
  epic_bug_fixes:
    _id: epic_bug_fixes
    name: Bug Fixes
    file: ../epics/[Epic]_bug-fixes.md

# Related Sprints (many-to-many)
sprints:
  sprint_bug_fix_01_2025_10_28_to_2025_11_04:
    _id: sprint_bug_fix_01_2025_10_28_to_2025_11_04
    name: bug-fix-01
    file: ../sprints/[Sprint]_bug-fix-01_2025-10-28_to_2025-11-04.md
    progress: 10%

# Related Tasks (many-to-many)
tasks:
  tsk_fix_product_fetch_error:
    _id: tsk_fix_product_fetch_error
    name: Fix Product Data Fetch Error
    status: todo
    file: ../tasks/[Task]_fix-product-fetch-error.md
  tsk_fix_layout_bug:
    _id: tsk_fix_layout_bug
    name: Fix PDP Layout Bug
    status: todo
    file: ../tasks/[Task]_fix-layout-bug.md

# Related Backlogs (many-to-many)
related_backlogs:
  backlog_bugs_002:
    _id: backlog_bugs_002
    name: PDP Error Handling
    file: ../backlogs/[backlog]_PDP-Error-Handling.md
---

# 🧱 Backlog: Bugs Tracking

## 🎯 Objective
Track and manage bug fixing tasks across the project.

## 🧩 Description
This backlog includes:
- Bugs reported in PDP
- UI and layout issues
- Backend GraphQL errors

## 🧾 Acceptance Criteria
- [ ] Each bug task linked to epics
- [ ] Each bug task assigned to a sprint
- [ ] Status updated after fixing

## 🔗 Related Epics
- [PDP Core](../epics/[Epic]_pdp-core-01.md)
- [Bug Fixes](../epics/[Epic]_bug-fixes.md)

## 🔗 Related Sprints
- [bug-fix-01](../sprints/[Sprint]_bug-fix-01_2025-10-28_to_2025-11-04.md) — 10%

## 🔗 Related Tasks
- [Fix Product Data Fetch Error](../tasks/[Task]_fix-product-fetch-error.md) — TODO
- [Fix PDP Layout Bug](../tasks/[Task]_fix-layout-bug.md) — TODO

## 🔗 Related Backlogs
- [PDP Error Handling](../backlogs/[backlog]_PDP-Error-Handling.md)
