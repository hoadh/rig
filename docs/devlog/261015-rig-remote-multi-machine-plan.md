# rig:remote Plan: Survived Red Team, Still Unbuilt

**Date**: 2026-10-15 11:45
**Severity**: High
**Component**: rig:remote (new skill, multi-machine orchestration over SSH)
**Status**: Plan ready, not implemented (phase 01 spike gate next)

## What Happened

Goal: a new skill `rig:remote` that drives Claude Code on macOS, Windows and Linux workers over SSH. State lives in files and git, not in a shared ledger. Path taken: SSH field experiment, then brainstorm, then a 7-phase plan (26h). The red team raised 39 findings, merged to 15. The user decided each one. Validation added optional phase fields (`dependsOn`, `reviewedSha`, `reviewScore`), a stub-claude E2E behind `RIG_E2E_CLAUDE=1`, Linux acceptance on a real VPS, and default `--max-turns 150`.

## Impact

The plan is only as good as its first assumption, and the red team found several that were wrong. The Windows scheduled-task story was pure guesswork: `/ST 23:59`, the 72h limit, battery behaviour, and PATH inheritance. Two of the critical findings were about things we had never tested. Nothing is implemented. Every line of this design is still a claim.

## Technical Details

- Critical: `baseRef` unverified (stale or unpushed base). Fix: dispatch passes an immutable SHA, verified via `ls-remote`.
- Critical: `node` / `claude` missing from non-interactive SSH PATH. Fix: absolute paths in the registry, `command-not-found` error class.
- Critical: lock TOCTOU and fail-open fetch. Fix: create-only push claim on `rig-coord/<slug>`, fail-closed.
- Worker agent runs as the same OS user, so it can reach the home directory and the inherited token. Only a partial fix is accepted.

## What We Tried

Patching the plan per finding, user deciding each item. 13 of 15 accepted (several with user variants, e.g. both Windows task modes kept, denylist overridable via `owns`). 2 accepted partially (#5 agent isolation, #14 ssh hardening). Rejected a write-ahead ledger, a mandatory dedicated OS user, and `ProxyCommand=none` (breaks jump hosts).

## Root Cause Analysis

The design went from "field experiment" to "7 phases" without a machine-level test of the detach path. The plan's own spike (phase 01) exists because the detached `claude -p` behaviour over SSH, especially on Windows, was not verified. The red team caught the gap; the plan had not.

## Lessons Learned

- Put a spike gate ahead of any code that depends on remote-machine behaviour. This plan does that (phase 01).
- Shared `.git` hooks and config are a privilege escalation path. Use a dedicated clone per worker.
- Run truth must come from worker run directories, not a second source of state.
- Keep tmux on Unix for humans to attach, even though it adds lifecycle work.

## Key Decisions

- Spike gates all code. Coord branch `rig-coord/<slug>` uses a create-only claim and fails closed.
- Owns plus denylist are checked before push. Denylist entries can be overridden only by an explicit `owns` line.
- Orchestrator-only review gate. Workers self-review before commit. Worker text is fenced UNTRUSTED.
- Keep both Windows task modes (interactive default, headless `/RU /NP`), selected by `taskMode`.

## Next Steps

- Run phase 01 spike on real Windows, macOS and Linux workers. Gate on `doctor` output before phase 02.
- Confirm threat model (injected worker agent in scope).

## Unresolved Questions

1. Should `collect` open a PR via `/rig:pr`? Deferred out of v1.
2. Worker auth after Windows reboot or logoff, and macOS keychain over SSH. Recorded in acceptance.
3. Does the remote allow force-push or deletion on `rig/*`? Does CI run on `rig/*` pushes with secrets?
4. Does `claude -p --resume` find the session from a recreated worktree path?

**Status**: Plan ready, not implemented.
