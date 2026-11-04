# Verification and Safety Guards: Implementation Shipped

**Date**: 2026-11-04 16:00
**Severity**: High
**Component**: Rig core (Stop verify guard, PreToolUse Bash guard, git push proof, debug evidence, Pending Live Verification, docs)
**Status**: Shipped on `feat/verification-guards` (not merged, not pushed). Plan stays In Progress until live items close.

## What Happened

All 8 plan items are implemented in 5 phases. P1 (Stop completion-evidence guard) is Completed. P2-P5 stay In Progress only for open `LIVE:` items. `npm test` 29/29 and remote suite 61/61 pass. Hooks are installed globally (backup `~/.claude/settings.json.bak-261104-154626`).

Waves: P2/P3/P4 in parallel worktrees, then P1 (reuses the P2 tokenizer), then P5 (registration, docs, sync). The P1 real-transcript gate passed before P1 code.

## Impact

- Stop guard nudges when edits lack a passing verification command. It checks exit status, not just that a command ran.
- Bash guard denies `pkill -f <pattern>` self-matches and `sed -i` on symlinks; asks on name-only kills.
- Push is reported only when commit proof and `git ls-remote` agree.
- Cost: every matching Bash call pays a check. Headless `ask` is a denial (accepted in the plan).

## Technical Details

- Stop feedback is an `attachment` entry (`hook_additional_context`) plus `system` `stop_hook_summary`, not a user entry. Headless signal: `CLAUDE_CODE_ENTRYPOINT=sdk-*` or `CLAUDE_CODE_SESSION_ATTENDED=0`.
- Review: 7/10 → 8/10 → 8/10. Cycle 1 C1: `$PRE` lost across separate Bash calls, so every commit read as "committed". Fixed in `560542b` (capture, commit and check in one call).
- ReDoS: shape checker lost to new patterns (`pgrep -f '<shape>' | xargs kill` still timed out at 8 s+). Replaced by `vm.runInContext` with 250 ms timeout; cached `vm.Script` in `f740f45` (1.4 ms → 0.19 ms per call).
- Cycle 3 N1 (High): block mode looped unbounded after the chain key became per-turn. Fixed in `f740f45` by making the chain turn-independent.
- Masking: `;`, `||`, `|`, `&`, `!` hide exit status. `|| exit 1` and `; echo $?` keep it.
- Pre-existing bug: `dev-rules-reminder` and `subagent-init` tests inherited `RIG_SESSION_ID` and read the live plan. Fixed in `55722bb`.

## What We Tried

- Shape-based ReDoS checker: rejected after three bypass rounds. A timeout is the reliable bound.
- Hosts registry (`rig-machines.json`): dropped; `ssh -G` rule instead.
- `permissions.ask` on hook and settings files: rejected in the plan (prompt friction).

## Root Cause Analysis

The P1 and P3 drafts assumed a flushed transcript at Stop, a passing exit status, and a pushed commit. Review caught these, not tests. Tests ran in one shell, so they could not see per-call state (`$PRE`), and they asserted our JSON rather than host behavior.

## Key Decisions

- P1 shipped last, gated on a real transcript capture. Trade-off: highest-risk hook arrived latest.
- Global install before the false-positive window closed. Trade-off: noise everywhere; mitigated by per-rule toggles and hook-log counts.
- Threat model is accidents, not a hostile agent. Stated in docs.

## Lessons Learned

- Verified-by-ran is not verified-by-passed. Pair each `tool_use` with its `tool_result`; read the exit status.
- Dogfooding finds what tests miss. The live Stop guard flagged `npm test 2>&1 | tail -1` in this session, and a re-run exposed a load-flaky latency test (fixed: median, skip when node baseline is slow).
- Live bash deny: `.claude/hooks/.logs/hook-log.jsonl:631` (`in-place-edit-symlink`). The first live attempt passed because the symlink was created in the same command. The guard checks before execution; documented as a limit.

## Next Steps

- **Alex (proposed, no dates agreed):** close `LIVE:` items: `process-kill` live deny (in a throwaway shell), headless `claude -p` guard-off log, git-operator scenarios, `/rig:debug` sections, progress-tracker dry run.
- **Alex (proposed):** review per-rule false-positive counts in `hook-log.jsonl` over the next few days; tune or flip global toggles.
- **Unscheduled follow-ups:** SubagentStop verify for `implementer`; parse tester verdict; `ps aux | grep | xargs kill` and `| parallel kill`; name-only `pkill` timeout fails open; hook-logger stale lock (250 ms); tests writing to the real `hook-log.jsonl`.

## Unresolved Questions

1. Does PreToolUse `ask` support `additionalContext`? Without it, blocked actions give Claude no remedy text.

**Status:** Shipped on branch, pending live evidence and merge.
