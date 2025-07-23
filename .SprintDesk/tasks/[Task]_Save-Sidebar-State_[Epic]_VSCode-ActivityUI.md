## ✅ Task: Save Sidebar State

- **🗂 Type:** Feature Task  
- **⏳ Estimated Duration:** 0.5 day  
- **🎯 Epic:** VSCode ActivityUI  
- **🚦 Priority:** 🟢 High  
- **📍 Status:** ⏳ Waiting

### Objective:  
Persist the state of the sidebar UI (selected tab, filters, etc.) across reloads of VS Code.

### Checklist:
- [ ] Store state in `globalState` or `workspaceState`  
- [ ] Load state when view is initialized  
- [ ] Reflect state in the UI components  

### Acceptance Criteria:
- [ ] State is restored accurately after VS Code restart  
- [ ] No flickering or incorrect rendering on load  
- [ ] UI reflects last known user interaction  

### Helpful Notes:
- Use `extensionContext.globalState.update()`  
- You can serialize UI state into a small JSON object
