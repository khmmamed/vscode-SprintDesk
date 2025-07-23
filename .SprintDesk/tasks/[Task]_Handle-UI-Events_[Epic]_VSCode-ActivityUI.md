
## ✅ Task: Handle UI Events

- **🗂 Type:** Feature Task  
- **⏳ Estimated Duration:** 0.5 day  
- **🎯 Epic:** VSCode ActivityUI  
- **🚦 Priority:** 🟠 Medium  
- **📍 Status:** ⏳ Waiting

### Objective:  
Handle user interactions (button clicks, input changes) from the sidebar and respond using VS Code APIs.

### Checklist:
- [ ] Setup message passing between webview and extension host  
- [ ] Register commands triggered by sidebar events  
- [ ] Implement event listeners in the React or JS frontend  

### Acceptance Criteria:
- [ ] User actions in the sidebar result in meaningful extension behavior  
- [ ] Messages are passed without delay or error  
- [ ] Extension logs or handles errors gracefully  

### Helpful Notes:
- Use `postMessage` from webview and `onDidReceiveMessage` in provider  
- Limit message types to keep communication clean
