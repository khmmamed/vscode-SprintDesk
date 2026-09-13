# SprintDesk Future Features Planning

> Note: The 0.4.0 / 0.5.0 / 0.6.0 feature lists in earlier versions of this file are **shipped**.
> See [`current-features.md`](current-features.md) for what exists today and
> [`v0.9-workforce-guide.md`](v0.9-workforce-guide.md) for the workforce architecture.

## Next Release (v0.10+)

### 🚀 End-to-End Employee Execution Flow (highest priority)
The biggest usability gap today: an employee currently cannot run the full loop from a single entry point.
- [ ] Task discovery → assignment/recommendation → dispatch → run → review, as one coherent flow
- [ ] UI/command surface for the flow (webview planning, run status, review inbox)
- [ ] Human-in-the-loop review of completed runs before tasks are marked done
- [ ] Observable run telemetry surfaced in the UI

### 🧭 Autonomy Iteration
- [ ] Standardize autonomy level semantics and defaults across scheduler + workflow DSL
- [ ] Per-schedule and per-workflow autonomy overrides
- [ ] Escalation when autonomy budget is exceeded (approval request instead of silent skip)

### ✨ Workforce Deepening
- [ ] Webview planning UI with run queue, approvals, and findings
- [ ] Team workload view and velocity analytics built on run records
- [ ] Richer failure classification + regression detection across retries
- [ ] Expand seed skill catalog and default task-type mappings

## Long-term Goals (1.0.0+)

### 🌐 Enterprise Features
- [ ] Custom workflow templates shipped as folders
- [ ] Jira / GitHub Issues / Azure DevOps / GitLab synchronization
- [ ] Enterprise reporting and export (PDF, Excel)
- [ ] Audit-log compliance tooling

### 🔒 Security Enhancements
- [ ] Encryption for sensitive data (credentials, tokens)
- [ ] Authentication integration for MCP servers
- [ ] Fine-grained access control lists beyond roles

### 🔄 AI Integration
- [ ] AI-powered task estimation and prioritization suggestions
- [ ] Smart sprint planning and capacity planning
- [ ] Predictive analytics on run/task history
- [ ] Natural-language task creation

### 📱 UI & Localization
- [ ] Customizable dashboard and dark-theme polish
- [ ] Multi-language support and localized templates
- [ ] RTL layouts and localized date formats

## Contributing Opportunities

We welcome contributions in the following areas:
- End-to-end execution flow and run telemetry
- Webview planning UI
- Feature development
- Documentation improvements
- Template customization
- UI/UX enhancements
- Testing and quality assurance
- Localization support

## Feature Request Process

1. Check existing issues for similar requests
2. Create a new issue with the "feature request" template
3. Include clear use cases and requirements
4. Discuss with the community
5. Wait for maintainer review and prioritization