// Centralized constants for SprintDesk

export const EXTENSION_NAME = "sprintdesk";
export const WEBVIEW_PANEL_TASKS_ID = "sprintdesk-tasks";
export const WEBVIEW_PANEL_PROJECT_STRUCTURE_ID = "sprintdesk.projectStructure";
export const WEBVIEW_PANEL_PROJECT_STRUCTURE_TITLE = "Project Structure";
export const WEBVIEW_PANEL_TASKS_TITLE = "SprintDesk Tasks";

// Webview bundling
export const WEBVIEW_MAIN_JS = "main.js";
export const WEBVIEW_LOCAL_SERVER = "http://localhost:9001";
export const WEBVIEW_DIST_DIR = "dist/webview";
export const WEBVIEW_MANIFEST_FILE = "manifest.json";

// SprintDesk hidden project folder and subfolders
export const SPRINTDESK_DIR = ".SprintDesk";
export const BACKLOGS_DIR = "Backlogs";
export const EPICS_DIR = "Epics";
export const SPRINTS_DIR = "Sprints";
export const TASKS_DIR = "Tasks";

// Defaults and labels
export const DEFAULT_LAST_COMMIT = "Initial";
export const DEFAULT_LAST_UPDATE_TODAY = "today";
export const DEFAULT_LAST_UPDATE_YESTERDAY = "yesterday";
export const DEFAULT_INIT_COMMIT = "Initial commit";

// UI labels and emojis
export const EMOJI_BACKLOG = "📌";
export const EMOJI_EPIC = "🧩";
export const EMOJI_SPRINT = "⏱️";
export const EMOJI_TASK = "✅";
export const EMOJI_PROJECT = "📂";
export const EMOJI_FILE = "📄";

export const STATUS_UPCOMING = "Upcoming";
export const STATUS_CLOSED = "Closed";
export const STATUS_IN_PROGRESS = "In Progress";

export const COLOR_STATUS_DEFAULT = "#94a3b8"; // gray
export const COLOR_STATUS_DONE = "#86efac"; // green
export const COLOR_STATUS_PROGRESS = "#facc15"; // yellow
export const COLOR_STATUS_BLOCKED = "#f87171"; // red
export const COLOR_SPRINT_UPCOMING = "#1f2937"; // slate-800
export const COLOR_SPRINT_CLOSED = "#065f46"; // emerald-900
export const COLOR_SPRINT_IN_PROGRESS = "#1e3a8a"; // blue-900

// App titles
export const APP_TITLE = "Sprint Desk v0.2.4";
export const PROJECTS_VIEW_TITLE = "Project Structure";
export const TASK_TABLE_TITLE = "Task Table";

// Common webview command strings
export const CMD_SET_TASKS = "SET_TASKS";
export const CMD_SET_BACKLOGS = "SET_BACKLOGS";
export const CMD_SET_EPICS = "SET_EPICS";
export const CMD_SET_PROJECTS = "SET_PROJECTS";
export const CMD_REQUEST_PROJECTS = "REQUEST_PROJECTS";
export const CMD_REQUEST_OPEN_FILE = "REQUEST_OPEN_FILE";
export const CMD_SAVE_SPRINT_TABLE = "SAVE_SPRINT_TABLE";

// Quick pick labels
export const QUICK_PICK_TASK_TYPE = "Select task type";
export const QUICK_PICK_PRIORITY = "Select priority";
export const QUICK_PICK_EPIC_PRIORITY = "Select epic priority";

// Sample/demo defaults used in UI fallbacks
export const SAMPLE_BACKLOG_1 = "Sample Backlog 1";
export const SAMPLE_BACKLOG_2 = "Sample Backlog 2";
export const SAMPLE_EPIC_1 = "Sample Epic 1";
export const SAMPLE_SPRINT_1 = "Sprint 1";
export const SAMPLE_TASK_1 = "Task 1";

// Colors used in Epics
export const DEFAULT_EPIC_COLOR = "#0b2cc2";
