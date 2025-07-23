## 📌 Task: Add Activity Bar Icon

- **🗂 Type:** Feature Task  
- **⏳ Estimated Duration:** 0.5 day  
- **🎯 Epic:** VSCode ActivityUI  
- **🚦 Priority:** 🟢 High  
- **📍 Status:** ⏳ Waiting

### Objective:  
Add a custom icon to the VS Code Activity Bar to represent the extension visually and provide easy access to its features.

### Checklist:
- [x] Create a unique icon (SVG or PNG, 32x32 preferred)  
- [x] Register the icon using `contributes.viewsContainers` in `package.json`  
- [x] Set a title and tooltip for the icon  
- [x] Test icon visibility in both light and dark themes  

### Acceptance Criteria:
- [x] Icon appears consistently in the Activity Bar  
- [x] Clicking the icon opens the corresponding sidebar view  
- [x] Icon works in light/dark themes without distortion  

### Helpful Notes:
- VS Code recommends a monochrome icon for best compatibility  
- Use `when` clauses if the icon should only show under certain conditions
