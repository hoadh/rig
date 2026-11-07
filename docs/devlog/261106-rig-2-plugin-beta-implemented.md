# Rig 2.0: Plugin Packaging Implemented (beta pending)

**Date**: 2026-11-06 14:55
**Severity**: High
**Component**: plugin layout, hooks, bin entrypoints, rig-init migrator, rig:remote, Antigravity sync, release
**Status**: Implemented on `feat/rig-2-plugin`, draft PR #4. CI green on Ubuntu, macOS and Windows, plugin validate green on Claude Code 2.1.292 and latest. Beta tag and LIVE checks pending.

## What Happened

Plan 261104-1426 ran in 5 phases on one branch. Each phase had an independent code review, and every Critical, High and Medium finding was fixed with a regression test before the next phase.

| Phase | Review score | Worst finding |
|---|---|---|
| P1 skeleton | 6/10 | Active plan lost in plugin mode (session state split) |
| P2 bin + runtime | 7/10 | First `rig-python` call ran the full system installer |
| P3 rig-init | 5/10 | y/N prompt could never be accepted; one-command consent bypass |

## Impact

- Rig installs as a plugin (`plugins/rig/`, marketplace `rig-marketplace`). The 1.x file installer is retired; 1.x stays on `release/1.x`.
- `rig-init` moves 1.x installs into backups with a journal, resumes after a crash and restores with a 3-way settings merge. It applies only in the user's terminal.
- Scripts are reached through `bin/rig-*` names. 243 hardcoded `.claude/...` paths are gone.

## Technical Details

- Spike first (Claude Code 2.1.318): plugin `bin/` is on PATH for the Bash tool only, never for the user's shell, and `CLAUDE_PLUGIN_ROOT` is set for hooks only. Plugin agent types are prefixed (`rig:x`); bare SubagentStart matchers do not match.
- So bins resolve their root from their own path, and every message that tells the user to run `rig-init` prints `node "<plugin dir>/bin/rig-init"`.
- Shared session state stays in the OS temp dir: Bash-run scripts cannot see `CLAUDE_PLUGIN_DATA`, so moving it broke `set-active-plan`.
- The consent gate refuses when `CLAUDECODE` is set, when any ancestor process is Claude Code, or when there is no TTY. It is defense in depth, not a guarantee.
- Windows CI found one product bug: the PowerShell ancestry query timed out at 5 s, so the gate refused every apply verb. Now 30 s.

## Lessons Learned

- Run the spike before the move. The `bin/` PATH and env findings changed P1-P3 design.
- A test that injects the prompt answer never proves the prompt works. C1 hid behind injected `ask` until a pty test.
- Consent checks need an adversarial review: `script`, `env -u` and `node -e` each bypassed the first version.
- Moving files is only safe when the journal records "copy complete" before deleting the source.

## Next Steps

- **Alex:** LIVE migrate round trip in a disposable HOME (runbook in the plan reports), Windows EBUSY check, Windows `bin/` via PowerShell and Git Bash, Linux->Windows remote dispatch.
- **Alex:** tag `v2.0.0-beta.1` with `node scripts/release-plugin.cjs --apply --allow-branch` in a terminal; install from GitHub on Linux, Windows and macOS.
- 2.1: npm deps outside the plugin cache, `--migrate` offering `--runtime`, a filtered Windows ancestry query.

## Unresolved Questions

1. Does `CLAUDE_PLUGIN_DATA` stay stable for a marketplace install across updates (verified for `--plugin-dir` only)?
2. Does a skill named `plan`, `debug` or `mcp` shadow the built-in command for plugin skills?
