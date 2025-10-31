/**

 * SprintDesk Constants
 * ===================
 * Centralized configuration for the SprintDesk extension
 */

/**
 * Project Structure
 * ================
 * Base directory and subdirectory configuration
 */
export const PROJECT = {
    SPRINTDESK_DIR: ".SprintDesk",
    BACKLOGS_DIR: "Backlogs",
    EPICS_DIR: "Epics",
    SPRINTS_DIR: "Sprints",
    TASKS_DIR: "Tasks",
    MD_FILE_EXTENSION: ".md",

    // File Naming Patterns
    FILE_PREFIX: {
        TASK: "[Task]_",
        EPIC: "[Epic]_",
        SPRINT: "[Sprint]_",
        EPIC_TASK_LINK: "../tasks/",
    },

    // IDs
    ID_PREFIX: {
        TASK: "tsk_",
        EPIC: "epic_"
    }
};

/**
 * Task Management
 * ==============
 */
export const TASK = {
    // Status
    STATUS: {
        NOT_STARTED: "not-started",
        IN_PROGRESS: "in-progress",
        DONE: "done",
        COMPLETED: "completed",
        BLOCKED: "blocked",
        WAITING: "✅ [waiting]",
        IN_PROGRESS_STATUS: "✅ [in progress]",
    },

    // Types
    TYPE: {
        FEATURE: "$(tools) Feature",
        BUG: "$(bug) Bug",
        IMPROVEMENT: "$(arrow-up) Improvement",
        DOCUMENTATION: "$(book) Documentation",
        TEST: "$(beaker) Test",
    },

    // Markers
    LINK_MARKER: "📌"
};

/**
 * Epic Management
 * =============
 */
export const EPIC = {
    STATUS: {
        PLANNED: "⏳ Planned"
    },
    TASKS_SECTION: "## 🧱 Tasks",
    TASKS_TABLE_HEADER: "| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|",
    DEFAULT_COLOR: "#0b2cc2"
};

/**
 * Sprint Management
 * ===============
 */
export const SPRINT = {
    SEPARATOR: {
        DATE: "-",
        DURATION: "_",
        YEAR_PREFIX: "20"
    }
};

/**
 * UI Colors and Themes
 * ==================
 */
export const UI = {
    // Sprint Colors
    COLORS: {
        SPRINT: {
            UPCOMING: "#1f2937",    // slate-800
            CLOSED: "#065f46",      // emerald-900
            IN_PROGRESS: "#1e3a8a"  // blue-900
        },
        STATUS: {
            DEFAULT: "#94a3b8",     // gray
            DONE: "#86efac",        // green
            PROGRESS: "#facc15",    // yellow
            BLOCKED: "#f87171"      // red
        }
    },

    // Status Text
    STATUS: {
        UPCOMING: "Upcoming",
        CLOSED: "Closed",
        IN_PROGRESS: "In Progress"
    },

    // Section Headers
    SECTIONS: {
        TASKS: "Tasks",
        TASKS_MARKER: "## Tasks",
        AUTO_COMMENT: "<!-- Tasks will be added here automatically -->"
    },

    // Icons and Emojis
    EMOJI: {
        COMMON: {
            BACKLOG: "📌",
            EPIC: "🧩",
            SPRINT: "⏱️",
            TASK: "✅",
            PROJECT: "📂",
            FILE: "📄",
            CALENDAR: "📅",
            LAST_UPDATE: "🗓",
            TOTAL_TASKS: "🛠",
            PROGRESS: "📊",
            SUMMARY: "📝",
            TASK_LIST: "📋",
            TASKS_SECTION: "🧱"
        },
        STATUS: {
            NOT_STARTED: "⏳",
            IN_PROGRESS: "🔄",
            DONE: "✅",
            BLOCKED: "⛔"
        },
        PRIORITY: {
            HIGH: "🔴",
            MEDIUM: "🟡",
            LOW: "🟢"
        }
    },

    // Quick Pick Options
    QUICK_PICK: {
        TASK_TYPE: "Select task type",
        PRIORITY: "Select priority",
        EPIC_PRIORITY: "Select epic priority",
        TASK_TITLE: "e.g., Implement Login Feature",
        CATEGORY: "e.g., frontend, backend, testing",
        COMPONENT: "e.g., authentication, database, ui",
        DURATION: "e.g., 2d, 4h, 1w",
        ASSIGNEE: "e.g., John Doe",
        EPIC_NAME: "e.g., User Authentication",
        EPIC_OWNER: "e.g., Team Lead"
    }
};

/**
 * Sample/Demo Data
 * ==============
 */
export const SAMPLE = {
    BACKLOG_1: "Sample Backlog 1",
    BACKLOG_2: "Sample Backlog 2",
    EPIC_1: "Sample Epic 1",
    SPRINT_1: "Sprint 1",
    TASK_1: "Task 1"
};

/**
 * Git Integration
 * =============
 */
export const GIT = {
    DEFAULT_COMMIT: "Initial",
    LAST_UPDATE: {
        TODAY: "today",
        YESTERDAY: "yesterday"
    },
    INIT_COMMIT: "Initial commit"
};

/**
 * WebView Configuration
 * ===================
 */
export const WEBVIEW = {
    APP_TITLE: "Sprint Desk v0.2.4",
    EXTENSION_NAME: "sprintdesk",
    PANEL: {
        TASKS: {
            ID: "sprintdesk-tasks",
            TITLE: "SprintDesk Tasks"
        },
        PROJECT_STRUCTURE: {
            ID: "sprintdesk.projectStructure",
            TITLE: "Project Structure"
        }
    },
    VIEWS: {
        PROJECTS_TITLE: "Project Structure",
        TASK_TABLE_TITLE: "Task Table"
    },
    COMMANDS: {
        SET_TASKS: "SET_TASKS",
        SET_BACKLOGS: "SET_BACKLOGS",
        SET_EPICS: "SET_EPICS",
        SET_PROJECTS: "SET_PROJECTS",
        REQUEST_PROJECTS: "REQUEST_PROJECTS",
        REQUEST_OPEN_FILE: "REQUEST_OPEN_FILE",
        SAVE_SPRINT_TABLE: "SAVE_SPRINT_TABLE"
    },
    BUNDLING: {
        MAIN_JS: "main.js",
        LOCAL_SERVER: "http://localhost:9001",
        DIST_DIR: "dist/webview",
        MANIFEST_FILE: "manifest.json"
    }
};