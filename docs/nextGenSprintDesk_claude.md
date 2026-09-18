Here's how I'd approach it. n8n's core idea, wiring together triggers, actions, and logic, is great. But it was designed when every step was deterministic, and AI ends up as one more node. I'd rebuild around the assumption that steps are probabilistic.

**1. Start from intent, not nodes.**
You'd describe the outcome ("when a support email arrives, classify it, check the order, draft a reply, and escalate if the customer is angry"), and the system would generate the workflow. The graph stays as an inspectable, editable artifact, but it's the output rather than the authoring burden.

**2. An autonomy dial on every step.**
Each step sits on a spectrum: plain code, a single LLM call, or a bounded agent with specific tools, a step limit, and a budget. Most workflows shouldn't be fully agentic, and the builder should make it easy to choose how much freedom each step gets.

**3. Crystallization.**
This is the idea I like most. If an agentic step behaves the same way across hundreds of runs, the system proposes replacing it with deterministic code, which is cheaper, faster, and more predictable. Workflows would get more reliable and cheaper over time instead of staying expensive forever.

**4. Typed contracts between steps.**
Every step declares its input and output schema. LLM outputs are validated, and when they fail, the system retries or repairs automatically instead of silently passing garbage downstream.

**5. Evals as a first-class feature.**
Before you change a prompt or swap a model, the system replays past real runs and shows what would have changed. It would also support shadow mode, where a new version runs alongside the old one without acting. Right now, most AI workflow tools have almost no testing story.

**6. Time-travel debugging.**
Every run is fully traced: inputs, outputs, prompts, tokens, cost, and latency per step. You can pick any step, edit its input, and re-run from there.

**7. Durable execution.**
It should have Temporal-style reliability: retries, idempotency, long waits, and pausing for human approval for days without losing state.

**8. Security built in.**
Untrusted content (emails, web pages) must never be able to trigger privileged tool calls, which is the main prompt-injection risk. Tools get least-privilege scopes, irreversible actions need approval gates, and everything is audited.

**9. Integrations via MCP and self-healing.**
Instead of hand-maintaining hundreds of nodes, use open tool protocols. When an API changes or breaks, an agent reads the docs, proposes a fix, and a human approves it.

**10. Workflows as code, with a visual view.**
The source of truth is a git-friendly file, with the canvas as a two-way projection of it. This gives you code review, versioning, and CI, while non-developers still get the visual interface.

**11. Cost-aware model routing.**
Use small, cheap models for easy steps, escalate to larger ones when confidence is low, cache aggressively, and enforce budgets per workflow.

If I were building it, I'd start with just the runtime, meaning durable execution, tracing, replay, and evals. Everything else builds on that foundation, and the prettier interface is the easier part.

Are you thinking of building something like this yourself, or exploring the idea? I can go deeper on architecture or a tech stack if that's useful.