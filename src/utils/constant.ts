/**
 * SprintDesk Constants
 * ===================
 * v0.0.1 - Initial version
 *
 * v1.0.0 Slice R — only live constants remain. The legacy Task/Epic/Backlog/
 * Sprint constant groups (and their `SprintDesk.*` global table-row types) were
 * unreferenced dead code and are removed.
 */

/**
 * Project Structure
 * ================
 * Base directory and subdirectory configuration
 */
export const PROJECT_CONSTANTS = {
    SPRINTDESK_DIR: ".SprintDesk",
    DATA_DIR: "data"
};

/**
 * WebView Configuration
 * ===================
 */
export const WEBVIEW_CONSTANTS = {
    BUNDLING: {
        MAIN_JS: "main.js",
        LOCAL_SERVER: "http://localhost:9001",
        DIST_DIR: "dist/webview",
        MANIFEST_FILE: "manifest.json"
    }
};
