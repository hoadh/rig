# Team coordination rules

The Rig hook gives every in-process teammate these rules as `## Team rules` (source: `hooks/lib/teammate-role-context.cjs`; keep both in step). Messaging, task claiming, idle notices and shutdown are Claude Code's own; this file only adds Rig's conventions.

## For teammates
- Your task is in your spawn prompt. If `TaskList` is available: check it, claim your assigned or the lowest-ID unblocked task with `TaskUpdate` (owner = your name, in_progress), read it with `TaskGet`.
- Edit only the files your task assigns to you. Need another file: message its owner or the lead first.
- If `TaskUpdate` is available, mark the task completed before you report. Not done: say why instead.
- Message teammates and the lead by name with `SendMessage`, one message per recipient.
- Reports go to the Reports path (default `plans/reports/`), `{type}-{date}-{slug}.md`: concise, unresolved questions last.
- On a shutdown request: finish the current step, update your task, then approve.
- Commits (only when the task asks): conventional, focused, no AI references; never force-push.

## For the lead
- Tasks own disjoint files; a tester owns test files only.
- Do not edit a teammate's files while it works; merge and fix after it reports.
- Two teammates need the same file: restructure the tasks. Conflicting review findings: synthesize and record the disagreement.
- After implementation tasks, state `Docs impact: none|minor|major` and update `docs/` when needed.
- A teammate whose task stays `in_progress` after it reported: check the work, then update the task or nudge the teammate (task status can lag).
