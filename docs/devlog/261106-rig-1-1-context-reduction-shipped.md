# Rig 1.1: Context Reduction and Native Feature Cleanup

**Date**: 2026-11-06 05:10
**Severity**: Medium
**Component**: rules, hooks, skills, agents, installer, docs
**Status**: Implemented on `feat/update-based-on-changelog`, PR #2. CI green on Ubuntu, macOS and Windows (run `42113581106`). Merge, tag `v1.1.0` and `release/1.x` pending approval.

## What Happened

Plan 261104-1530 shipped in 5 phases, one commit each, plus 2 fix commits. It trims what Rig loads into every session and removes features Claude Code now ships natively.

## Impact

- One `core-rules.md` (~1.7 KB, budget-tested) replaces 5 always-loaded rule files. Task-specific rules moved into the skills that use them.
- UserPromptSubmit sends a short `Now:` line per prompt and the full block only when it changes.
- Removed: sequential-thinking skill, notification hooks, output styles and `codingLevel`. Thinned worktree, explore, code-review and team.
- Dead tool references went from 510 to 0 (Task tool is now Agent tool). The Tasks API is optional.
- Agents use `effort` and `skills` preload. UI skills use `paths:`.
- Upgrades: the installer backs up retired `rules/` and `output-styles/` files as `.bak` and keeps retired hooks that settings still reference.

## Technical Details

- Plugin-prefixed agent types (`rig:tester`) are normalized before hooks key on them. The remote owns-denylist covers plugin, hook and `.worktreeinclude` paths.
- Subagents get core rules through native `.claude/rules/*.md` loading. Hook injection (`subagent.injectCoreRules`) is opt-in to avoid sending them twice.
- New guard tests: always-loaded budget, removed-features scan, dead-tool scan, disable-model-invocation chain scan.
- First PR CI failed on Windows only: the budget test counted CRLF bytes (team/SKILL.md 2511 vs 2500). It now counts LF bytes.

## Lessons Learned

- Size budgets must measure repo content, not the checkout. CRLF adds a byte per line on Windows.
- A guard scan that bans removed names keeps docs honest, but every future doc must follow it (CHANGELOG and devlog are exempt).
- Deleting `disable-model-invocation` from `pr` was needed: the flag hid `/rig:pr` from the model and broke chained invocation.

## Next Steps

- **Alex:** approve merge to `main`, tag `v1.1.0`, create `release/1.x`.
- LIVE checks: `/context` before/after, subagent quotes a core rule, team spawn and `~/.claude/teams` config, code-review wrapper, monorepo worktree, chained skills, web agent tool list, Linux and Windows smoke.
- Flaky on Windows (pre-existing): `worker-run-entry-flow`, `worker-detached-launch-protocol`, `remote-run-status-cancel-loopback`. The full diff shows a PowerShell `echo` hitting the 30 s timeout (exit 124), and `Get-Process` timing out at 10 s in the same run. Likely slow PowerShell start under parallel load; not proven.
- Then plan 261104-1426 (2.0 plugin packaging).

## Unresolved Questions

1. Is the Windows remote flakiness a runner load issue, or does PowerShell hang in the supervised child? Needs a timing log on the next failure.
