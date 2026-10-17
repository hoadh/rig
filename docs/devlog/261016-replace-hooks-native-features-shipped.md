# Replaced Rig Hooks With Native Claude Code Features

**Date**: 2026-10-16 17:36
**Severity**: High
**Component**: Rig hook layer, settings registration, installer (`.claude/hooks/`, install scripts)
**Status**: Resolved

## What Happened

Audited the kit hooks against current CC behaviour. Removed 11 kit hooks. Privacy and heavy-directory blocking moved to `permissions.ask` / `permissions.deny`. Usage awareness moved to statusline stdin `rate_limits`. File naming moved to rules text. Kept `session-init`, `subagent-init`, `dev-rules-reminder` (reminder shrunk 2634 to 665 bytes) and `team-context-inject`. Diff: 53 files, +840 / -2212.

## Impact

Several hooks had been silently dead for longer than anyone noticed. Tests passed because they asserted the JSON we emitted, not what CC consumed. `descriptive-name` returned `allow` on every Write, so a naming helper was bypassing the permission prompt. That is the worst kind of hook: it looks like a guard and removes one.

## Technical Details

- `session-state` load branch never ran: guard required `hook_event_name`, which CC always sends.
- Top-level `additionalContext` is ignored by CC. Only `hookSpecificOutput.additionalContext` is consumed.
- `session-init` resolved the plan without the session id. Resume and compact wiped the active plan, and `CLAUDE_CODE_TASK_LIST_ID` was never exported. Fixed.
- Privacy: 24 Read/Edit `permissions.ask` rules. Heavy directories: `permissions.deny` for `node_modules`, `.venv`, `venv`, `__pycache__`, `.next`, `.nuxt`, `coverage`.
- Installer strips retired kit hook registrations (absolute, Windows and quoted path forms), deletes retired files, and unions `permissions` with the user's existing lists. If another registration still runs a retired file, it keeps it and warns.
- Live check on CC 2.1.301: 5/5 checks passed. Review score 9.5/10. Test suite green.

## What We Tried

- Keeping Bash blocking and broad-glob detection in the old directory-blocking hook. Dropped by user decision.
- Reading usage via OAuth/Keychain. Dropped: statusline stdin already carries `rate_limits`.

## Root Cause Analysis

We wrote hooks without checking the output contract against CC. Unit tests validated our own output format, so a hook that CC ignored still passed. Permission policy lived in a hook that returned `allow`, which no test flagged as a bypass.

## Lessons Learned

- Verify hook output by observing a live session, not by asserting emitted JSON.
- Never return `allow` from PreToolUse unless you intend to bypass the user. Put policy in `permissions.ask` / `deny`.
- Prefer native features first: permissions, statusline stdin, `.claude/rules/*.md`.
- Trade-off accepted: `ask`/`deny` cover Read and Edit only. Bash `cat .env` is no longer intercepted. That is a real gap, not a solved one.

## Next Steps

- Owner: user. Review and commit the 53-file change set.
- Owner: user. Confirm the migration note covers the removed hooks and the Bash gap.
- Owner: next maintainer. Add a live hook-output check to the test plan so this class of bug is caught without a manual session.

## Unresolved Questions

1. Accept the Bash `cat .env` bypass, or add a Bash-level guard later?
2. Should retired-file warnings from the installer persist beyond one install run?
