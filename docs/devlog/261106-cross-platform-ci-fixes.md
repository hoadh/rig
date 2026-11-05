# Cross-Platform CI Fixes: First Full macOS and Windows Run

**Date**: 2026-11-06 01:25
**Severity**: Medium
**Component**: rig:remote local worktrees, Bash command tokenizer, node test suites, CI
**Status**: Merged to `main` (PR #1, `65d3f18`..`6c96448`). CI green on Ubuntu, macOS and Windows.

## What Happened

Pushing `main` after the self-assessment merge ran every node suite on macOS and Windows for the first time (run `42068907097`). Ubuntu passed. macOS failed 1 file, Windows 11. Branch `fix/cross-platform-tests` fixed them in 4 commits. Its CI took three runs to go green (`42075474597`).

## Impact

- Two real Windows bugs fixed, the rest were POSIX-only test assumptions.
- `rig:remote` refused valid `.rig/<dir>` worktrees on Windows when the repo path held an 8.3 short name, which broke collect, takeover and the orchestrator lock.
- Phase 1 LIVE item "CI green on all 3 OSes" of plan 261104-1427 is closed, and so is phase 7's drift check.

## Technical Details

- `fs.realpathSync` (JS) keeps `C:\Users\RUNNER~1\...`, while git prints `C:/Users/runneradmin/...`. `fs.realpathSync.native` expands both forms to the same path.
- Tokenizer `applyCd` returned an absolute `cd` target raw (`/abs`) but resolved relative ones. Now both use `path.resolve`.
- Test-only causes:
  - macOS tmpdir `/var` is a symlink to `/private/var`.
  - Windows CRLF checkouts broke the push-proof regex.
  - `path.relative` returns `\` separators.
  - `GIT_CONFIG_GLOBAL=os.devNull` (`\\.\nul`) cannot be opened by git for Windows.
  - The `#!/bin/sh` fake git with `:` as PATH separator does not run on Windows.
  - Hardcoded `/tmp`, `/etc/passwd` and `VAR=x cmd` syntax.
- The `rig:remote` minimal test harness printed 4 stack lines, which cut assertion diffs to `[`. It now prints the full message and the first frame.
- One macOS job never got a runner and was cancelled at `timeout-minutes: 15` with no steps run. A rerun passed.

## Root Cause Analysis

Before plan 261104-1427 P1, CI ran 29 test files and only on Linux. Windows-specific code had tests, but none ran on Windows. Tests built expected values from `os.tmpdir()` or literal POSIX paths instead of the form the code under test returns.

## Lessons Learned

- Compare filesystem paths with `realpathSync.native` on both sides. The JS realpath does not canonicalize Windows short names or case.
- When a test compares paths, build the expected value the same way the code does (realpath, `path.sep`), not from raw `os.tmpdir()`.
- Do not trust a test harness that truncates failure output. The first Windows reruns gave no diff to diagnose.
- Rerun on the base branch before blaming a branch. Two `rig:remote` failures also failed on `main` and later passed: they are flaky.

## Next Steps

- **Flaky on Windows:** `worker-run-entry-flow` ("command run") and `worker-detached-launch-protocol` ("exec: foreground"). Diagnose with the full diff the harness now prints the next time they fail.
- **Alex:** make `ci` a required status check on `main`, and run the negative CI check (plan 261104-1427 P1).
- **Alex:** run the interactive `cat .env` probe (P2).

## Unresolved Questions

1. Why do the two `rig:remote` command-run tests fail only sometimes on Windows? This is timing or the runner image; there is no diff yet.
2. Should `run-directory.cjs` also hash `realpathSync.native`? It is left unchanged to keep existing run directory keys stable.
