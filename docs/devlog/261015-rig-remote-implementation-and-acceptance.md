# rig:remote Built, Then Real Machines Broke It

**Date**: 2026-10-15 18:15
**Severity**: High
**Component**: rig:remote (multi-machine orchestration over SSH), Windows ssh transport
**Status**: Blocked (manual acceptance partially done, 3 items need the user)

## What Happened

Phases 1-6 are implemented. Suite passes 54/54 files. Phase 7 acceptance ran on three real machines: mac `alexpro` (orchestrator), Windows `waso` (headless S4U task), Linux `laco-staging` (Ubuntu 24.04). Stub claude covered mac-worker and takeover runs. Real claude ran on waso (phase 02) and laco-staging (phase 03). Review round 6 scored 9.6, 0 critical/high. The D7 fix scored 9.5 after round 3.

## Impact

The suite was green and the reviews were clean, and the real machines still found the bugs that matter. The Windows orchestrator hung on every `ssh` call. The suite did not catch it, which means the suite never exercised real `ssh.exe` stdio. On waso, a detached run also took about 65s to start because the S4U task was not kicked with `/Run`.

## Technical Details

- **S4U `/Run` start latency**: detached run on waso took ~65s before the fix. Now 4s. Both task modes call `schtasks /Run` after `/Create`. `runner.lock` blocks double fire.
- **D7 Windows ssh hang**: OpenSSH_for_Windows 9.5p2 `ssh.exe` with node pipe stdio never exits after writing output and never forwards stdin EOF.
- **Fix**: new `lib/capped-child-process-runner.cjs`. On win32 it uses temp files for stdin/stdout/stderr. Transport and the doctor probe both use it.
- **Review findings on the fix** (round 1 scored 6/10): spawn `ENOENT` reached an uncaught exception because `close` read already-deleted temp files. Also unbounded disk writes while the child ran. Both fixed. A 250 ms `fstat` poll now kills the child on oversize output.
- **Mac keychain**: over non-interactive ssh the login keychain is locked. `claude auth status` reports not logged in. git https via osxkeychain fails with `-25308`.
- **Lost detection**: `kill -9` on the runner gave `lost` after 118s (threshold 90s).

## What We Tried

- Temp-file stdio on win32 only. Pipes remain the path elsewhere.
- Ssh origin for the mac worker clone instead of https. This avoids the keychain for git. It does not fix `claude`.
- Remaining mac fix: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, set in the user's ssh env. Not done, needs user.

## Root Cause Analysis

Two real-world behaviours were never in the test path: Windows ssh.exe stdio semantics and the macOS login keychain being locked over ssh. The first is a transport bug. The second is an environment property, not a code bug, and no unit or stub test can see it.

## Lessons Learned

- A green suite against stubs proves the protocol, not the transport. Run one real-host check before calling a transport done.
- Spawn-error paths deserve a test. The ENOENT path only surfaced in review.
- Do not assume a desktop credential store exists on a headless SSH session. Use an explicit token env var.
- Put a size cap on any child-process capture from the first commit, not after review.

## Key Decisions

- Windows `ssh` uses temp-file stdio (chosen over pipes, which hang with ssh.exe on waso).
- Keep S4U headless as default; `taskMode: interactive` stays opt-in for GUI work.
- Worker-to-worker legs (linux to waso) skipped by user choice: no keys between workers.

## Next Steps

- Owner: user. Set `CLAUDE_CODE_OAUTH_TOKEN` on mac, then rerun real claude on the mac worker.
- Owner: user. Run waso `taskMode: interactive` dispatch with `dev` logged on at the console.
- Owner: user. Reboot or log off waso, then verify worker auth.
- Owner: user. Decide on committing the uncommitted D1-D7 fixes (repo copy only, nothing committed yet) and on docs verification.

## Unresolved Questions

1. Allow `(` and `)` in `pathPrepend` (e.g. `Program Files (x86)`)? Workaround is the 8.3 short path.
2. Cleanup of sandbox branches `rig-coord/*`, `rig/*`, `rig-int/*` and worker temp kit dirs. Keep the sandbox repo?
3. Cost recording (`total_cost_usd`) is unit-tested only. Needs one paid run to verify.
4. POSIX `:` in `pathPrepend` splits PATH (round 6 L1, not fixed; operator-trusted).

**Status**: Blocked on user actions above.
