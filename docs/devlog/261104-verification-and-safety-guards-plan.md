# Verification and Safety Guards: 8-Item Plan

**Date**: 2026-11-04 14:37
**Severity**: High
**Component**: Rig core (new Stop and PreToolUse Bash hooks, `settings.json`, rules, git/debug skills, progress workflow, docs)
**Status**: Planned (plan approved; nothing implemented or committed)

## What Happened

Plan only, nothing shipped. The user ran `/insights` over 30 sessions (2026-11-01..04, mostly Linux sysadmin, few dev) and asked for software-development improvements to Rig. 8 items were proposed; all 8 accepted.

`plans/261104-1032-verification-and-safety-guards/plan.md` maps them to 5 phases on `feat/verification-guards`:
- Wave 1 (parallel worktrees): P2 Bash safety guard, P3 rules/git/debug text, P4 pending live verification.
- Wave 2: P1 Stop completion-evidence guard (after P2 tokenizer).
- Wave 3 (serial): P5 hook registration, docs, Antigravity sync, devlog.

## Impact

Closes: unverified completion claims, unproven pushes, `pkill <name>` and symlink-edit footguns, guessed SSH users, unverified production paths.

Cost: the Bash guard prompts on every matching command. Under headless `claude -p` and rig:remote workers, `ask` is a denial (accepted).

## Red Team and Validation

- 3 reviewers, 30 raw findings, deduped to 15 (2 Critical, 9 High, 4 Medium). All accepted; 4 modified; 1 sub-part rejected: `permissions.ask` on `.claude/hooks/**` and settings (prompt friction).
- Threat model: guards prevent accidents, not a hostile agent.
- Largest draft flaws:
  - Verify guard credited a command that ran, not one that passed. No `tool_use`/`tool_result` pairing; `|| true` not excluded.
  - Turn scan assumed the transcript is flushed at Stop. Docs say otherwise. Now a bounded poll, else allow and log.
  - Implementer subagent calls invisible to the main-session guard.
  - Push proof passed on a failed commit (`HEAD == @{u}`); fixed with PRE/HEAD commit proof plus `git ls-remote`.
  - Kill rule syntactic; wrappers and broad kills slipped through.
- Validation: P1 kept but shipped last, gated on a real transcript capture; global install right away (user choice over the dogfood recommendation); headless `ask` = deny accepted.

## Key Decisions

- **Item 6 dropped as a registry.** Planned read-only hosts registry in `rig-machines.json` rejected. Root cause: the machine had no `~/.ssh/config` (or `rig-machines.json`), so Claude guessed SSH users from shell history. A registry would break older builds (`loadRegistry` rejects unknown top-level keys) and duplicate `~/.ssh/config`. Replacement rule: `ssh -G <host>`, ask once, offer a `Host` entry, prod read-only.
- **Item 8:** keep the earlier `locale.responseLanguage` deprecation; docs only; repo stays English.
- **Blocks plan 261028:** its secret-file guard plugs into P2's rule contract (`opaquePolicy`, `crashPolicy`); no second PreToolUse Bash hook.
- **Rollback:** revert the P5 registration commit first, so no hook entry points at a missing file.

## Root Cause Analysis

The draft promised mechanisms the docs and code do not provide: a flushed transcript at Stop, `tool_result` pairing, `@{u}` as the pushed ref. Same failure as 261028. Red team caught them before any code.

## Lessons Learned

- Grep code and docs for each mechanism a plan depends on before promising it.
- A check must be able to fail: pair each `tool_use` with its `tool_result` and read the exit status.
- Hooks on every Bash call need a cost budget; the hook-logger lock can add 250 ms per call (follow-up).

## Next Steps

- **Orchestrator**: `git checkout -b feat/verification-guards main`, then `/rig:implement` on the plan in wave order.
- **User**: approve the P5 gate (global install after the P1 transcript capture passes).
- No dates set.

## Unresolved Questions

1. Headless detection signal: how a hook tells `claude -p` or a rig:remote worker from interactive use. Needed for the P1 headless off-switch.
2. Does PreToolUse `ask` support `additionalContext`? Without it, Claude gets no remedy text on a blocked kill or symlink edit.
3. Does Claude Code's `language` settings key exist? Item 8 depends on it.
