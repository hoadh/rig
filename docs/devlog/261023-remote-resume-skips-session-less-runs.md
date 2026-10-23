# rig:remote `dispatch --resume` Blocked by a Session-less Run

**Date**: 2026-10-23 14:48
**Severity**: Medium
**Component**: rig:remote orchestrator `dispatch` (`.claude/skills/remote/scripts/commands/dispatch-command.cjs`)
**Status**: Fixed (commit 6d10e8e)

## What Happened

A correction round on phase 10 failed. `dispatch --resume --message-file` stopped with `no earlier agent session found for phase 10`, even though an earlier phase 10 run had a valid claude session. The last run of the phase was `failed: not-started` (the launcher never fired), and it had no session.

## Impact

Review → fix rounds on a remote phase were blocked. There was no workaround: a fresh dispatch does not accept `--message-file` (by design), and it starts a new session with the original phase prompt. So the review feedback could not reach the agent.

## Technical Details

- `--resume` took `runs.filter(phase).pop()` and read `result.claude.session_id` from that run only.
- Worker `list` sorts by `startedAt`, which is `run.json` `createdAt`. A not-started run created later sorts last.
- Any run that fails before claude starts (`not-started`, `prepare`, `lock`, `auth`) has no session and caused the same failure.
- Fix: walk the phase's agent runs newest-first and take the first with a session. If none has one, `no-session` is still raised. Usually costs 1-2 `status` ssh calls.
- Regression test in `dispatch-and-collect-orchestrator-flow.test.cjs`: it fails with the exact error without the fix and passes with it. 58/58 remote test files green.

## Root Cause Analysis

The code assumed "last run = run with the session to continue". That holds only when every run reaches claude. Runs that fail before the agent starts break it.

## Key Decisions

- **Newest run with a session, not newest `done` run.** A failed run (timeout, max turns) that reached claude still has a session worth resuming. Cost: one ssh `status` call per skipped run.
- **Keep `--message-file` tied to `--resume`.** A correction message only makes sense inside the earlier session.

## Lessons Learned

- "Last item" lookups over run history must say which property they need, and skip entries that lack it. Failed runs keep their place in history.
- Tests only covered the happy path, where every fake run had a session. Add fixtures for runs that failed before starting.

## Next Steps

- None required. Re-run the blocked phase 10 correction round with `dispatch ... --resume --message-file <file>`.

## Unresolved Questions

1. Should `status` / `collect` also ignore session-less runs when they pick the "latest" run of a phase? Not audited in this fix.
