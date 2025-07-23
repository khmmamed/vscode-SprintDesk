## ✅ Task: Add Activity Bar Icon

- **🗂 Type:** Feature Task  
- **⏳ Estimated Duration:** 0.5 day  
- **🎯 Epic:** VSCode ActivityUI  
- **🚦 Priority:** 🟢 High  
- **📍 Status:** ⏳ Waiting

### Objective:  
Add a custom icon to the VS Code Activity Bar to represent the extension visually and provide easy access to its features.

### Checklist:
- [ ] Create a unique icon (SVG or PNG, 32x32 preferred)  
- [ ] Register the icon using `contributes.viewsContainers` in `package.json`  
- [ ] Set a title and tooltip for the icon  
- [ ] Test icon visibility in both light and dark themes  

### Acceptance Criteria:
- [ ] Icon appears consistently in the Activity Bar  
- [ ] Clicking the icon opens the corresponding sidebar view  
- [ ] Icon works in light/dark themes without distortion  

### Helpful Notes:
- VS Code recommends a monochrome icon for best compatibility  
- Use `when` clauses if the icon should only show under certain conditions
