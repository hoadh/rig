# Team Coordination Rules

Moved from `.claude/rules/team-coordination-rules.md`. Applies only to teammates inside an Agent Team; no effect on normal sessions or subagents.

## File Ownership
- Each teammate owns distinct files, defined by globs in the task (`File ownership: src/api/*`). Overlapping edits corrupt each other's work.
- Tester owns test files only. On an ownership conflict, stop and report to the lead, who restructures tasks.

## Git
- Prefer one worktree per implementer; commit to the worktree branch, not main or dev. Never force-push. Pull before push. Commit often.
- Conventional commits, no AI references, focused changes.

## Communication
- Use `SendMessage` to a named teammate; broadcast only for critical blockers affecting everyone.
- Mark the task completed via `TaskUpdate` before reporting. Reports carry actionable findings, in plain text, concise, unresolved questions last. Save to `{RIG_REPORTS_PATH}` (fallback `plans/reports/`) as `{type}-{date}-{slug}.md`.
- Lead states `Docs impact: none|minor|major` after implementation tasks and updates `docs/` when needed.

## Tasks and Plans
- Claim the lowest-ID unblocked task, set it `in_progress`, check `TaskList` afterwards; if all are blocked, tell the lead.
- With `plan_mode_required`: plan read-only, submit via `ExitPlanMode`, wait for approval, revise if rejected (rejected twice: lead takes over).

## Conflicts and Shutdown
- Same file needed by two teammates: escalate to the lead. Conflicting review findings: lead synthesizes and records the disagreement. If blocked, message the owner first, then the lead.
- Approve shutdown requests unless mid-critical-operation; finish the current task first and pass the `requestId` to `shutdown_response`.
- Idle is normal, not an error; messaging an idle teammate wakes it. Check task status, not idle notices, for completion.
- Discover teammates in `~/.claude/teams/{team-name}/config.json`; refer to them by name.
