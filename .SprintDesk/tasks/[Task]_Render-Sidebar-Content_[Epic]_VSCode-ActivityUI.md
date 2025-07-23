## 📌 Task: Render Sidebar Content

- **🗂 Type:** Feature Task  
- **⏳ Estimated Duration:** 1 day  
- **🎯 Epic:** VSCode ActivityUI  
- **🚦 Priority:** 🟠 Medium  
- **📍 Status:** ⏳ Waiting

### Objective:  
Display custom React content inside the registered sidebar using a webview.

### Checklist:
- [ ] Create a webview provider using `vscode.WebviewViewProvider`  
- [ ] Inject React/HTML content into the webview  
- [ ] Secure webview with `Content-Security-Policy`  
- [ ] Load static files (JS, CSS) correctly  

### Acceptance Criteria:
- [ ] Sidebar renders dynamic content (e.g., a component or layout)  
- [ ] Webview is responsive and reloads correctly  
- [ ] No console or CSP errors appear in dev tools  

### Helpful Notes:
- Use `vscode-resource:` URIs to load scripts and styles  
- Consider using a bundler like Webpack or Vite for better dev experience
