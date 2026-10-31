# Windows Compatibility Fixes

**Date**: 2026-10-30
**Severity**: Medium
**Component**: hooks, rig:remote (worker kill guard, HOME hashing), skill scripts, installer, `.gitattributes`, instruction docs
**Status**: Merged to main (fast-forward from `fix/windows-compat`). Verified on Windows 11 and Linux (Ubuntu on WSL2). macOS not verified.

## What Happened

Three tester reports (`plans/reports/tester-261030-0800-windows-compat-*.md`) listed Windows breakages across hooks, rig:remote, skill scripts and instruction docs. The plan (`plans/261030-1408-windows-compatibility-fixes/plan.md`) fixed the verified ones in 9 phases. A code review of the branch (`plans/reports/code-reviewer-261030-2102-windows-compat-branch-review.md`) found one critical issue introduced during the work and several regressions. They were fixed before this entry.

## What Shipped

| Area | Change |
|------|--------|
| Hooks | `RIG_REPORTS_PATH` and `RIG_PLANS_PATH` no longer double-rooted (all platforms). `subagent-init` resolves absolute `paths.plans`/`paths.docs`. "Subdirectory mode" banner compares paths with `samePath`. |
| rig:remote kill | win32 kills the recorded agent only when its StartTime matches. Identity read failure fails closed. Supervisor skips `taskkill` on an exited child's pid. |
| rig:remote HOME | Global-config hash reads the same file git reads (no MSYS conversion). See decision below. |
| Installer | Retired hooks and files (`scout-block`, `privacy-block`, `descriptive-name`, ...) are removed from existing installs. |
| Skills | markdown-viewer PID dir on win32 is `os.tmpdir()`. `shadcn_add` finds `npx.cmd`, validates names, accepts `@scope/name`. `create-skill` `run_eval` runs on Windows, sends the query via stdin. UTF-8 output on piped stdout. |
| Install entry points | `install.sh` exits on msys/cygwin with a hint to run `install.ps1`. Kit installer `--install-skills` runs `install.ps1` on win32. |
| Line endings | `.gitattributes` pins LF for `*.sh` and `ui-design` data. Fixes `validate_data.py` on Windows clones. |
| Instruction docs | Agent and skill docs give Windows-safe commands. |
| Tests | Hook and remote fixtures are platform-aware. Windows fake executables are real `.exe` files (see below). |

## Key Decisions

- **`.gitattributes` over per-file CRLF handling.** `*.sh` and the hashed `ui-design` data are stored as LF in the index. Windows checkouts with `core.autocrlf=true` otherwise change the bytes, which breaks `validate_data.py` and shell scripts. Cost: none on POSIX, where the index was already LF.
- **csc.exe shim for win32 test fakes.** libuv spawns only real `.exe` files, so a JS or `.cmd` fake cannot stand in for `git`, `ssh` or `claude`. `fake-executable-for-tests.cjs` compiles a small C# launcher with the .NET Framework `csc.exe` (ships with .NET Framework 4 on Windows). The launcher runs the fake in a Job Object with `KILL_ON_JOB_CLOSE`. The helper throws if `csc.exe` is missing; it never skips.
- **H3 (runner kill takes the agent along): docs only.** A probe (`plans/261030-1408-windows-compatibility-fixes/reports/probe-h3-runner-kill.md`) showed that `schtasks /End` and `taskkill /F` on the runner also killed a non-detached dummy child. The probe did not use `claude.exe`. Policy: document the behavior and rely on `remote cancel` and the orphan sweep. No watchdog. A watchdog is a follow-up if a real agent survives.
- **H6 reverted (MSYS `HOME` is not translated).** The first fix converted `HOME=/c/Users/x` to `C:\Users\x` before hashing. The reviewer showed that native git for Windows does not translate MSYS `HOME`. It reads the drive-relative `\c\Users\x\.gitconfig`. The fix therefore hashed a file git ignored and missed the one git loads. Current code hashes `env.HOME || os.homedir()` as-is, which is what git reads. The how-to documents the Windows-form `HOME`.

## Review Catch: cmd.exe Injection

`run_eval.py` used `shutil.which("claude")` and passed the eval query in argv. On Windows, `which()` resolves an npm-installed CLI to `claude.CMD`. CreateProcess runs `.cmd` files through `cmd.exe`, which ignores the `\"` escaping that `list2cmdline` applies. A query such as `a" & echo X>m & "` ran the shell command. The review reproduced it with a fake `claude.cmd`.

Fix: the query goes through stdin, not argv. The branch's own `shadcn_add.py` already used this pattern for the same class of problem.

Lesson: a resolver that honors PATHEXT can return a shim. Check what the resolved path is before it reaches argv.

## Verification Status

| Platform | Status |
|----------|--------|
| Windows 11 (this host) | `npm test` 18/18, `run-all-remote-tests.cjs` 60/60 |
| Linux (Ubuntu on WSL2) | `npm test` 18/18, `run-all-remote-tests.cjs` 60/60 (46.8s), markdown-viewer 29/29, install-kit tests green, pytest create-skill 6 and ui-styling 85 passed. Clone on the WSL filesystem, not `/mnt/c`. |
| macOS | NOT verified |

Both platforms: the remote suite skips the real-`claude` and real-ssh e2e tests unless `RIG_E2E_CLAUDE=1` / `RIG_E2E_SSH=1`. The Python tests (`test_shadcn_add.py`, `test_run_eval_reader.py`) pass on both.

## Follow-ups

| Item | Note |
|------|------|
| `rig-config-utils.cjs` over 500 LOC | Split per code standards |
| `test-clone-config-resetter.cjs:60` | Product bug: raw `url =` line with a backslash escape |
| No non-schtasks launch path on win32 | Where `schtasks /Create` is denied, runs cannot launch |
| H7 | `physicalPath` splits on `/` only (`global-gitconfig-hash-inputs.cjs`) |
| H8 | `chmodSync 0o600` is a no-op on Windows (`runner-env-handoff.cjs`). Protection is the NTFS ACL of `%USERPROFILE%\.rig` |
| H9 | `safeGit` timeout kills only `git.exe` (`safe-git-runner.cjs`); grandchildren may hold pipes |
| Worktree W1 | `worktree.cjs` accepts a POSIX root (`/etc/passwd`) on Windows |
| markdown-viewer `run-tests.cjs` | References a missing `dashboard-renderer.cjs` |
| Code-review reference `.md` files | Six files have CRLF blobs in the index |
| win32 agent watchdog | Only if a real agent survives a runner kill (H3) |

Review findings C1, I1-I3, M1-M6 and minors m1-m4, m6-m8 were fixed on the branch before merge. m5 (test harness prints early-returned tests as `ok`) remains; see the review report.

## Next Steps

- Run the suites on macOS when a machine is available.

## Unresolved Questions

1. Does `taskkill /T` filter children by creation time, so that stale-PPID orphans are not killed? Not verified.
2. Does a production runner ever see an MSYS `HOME`? The H6 revert is correct either way, but reachability is unproven (plan Q3).
3. Does S4U headless mode behave like the interactive probe for the H3 kill? `schtasks /Create` was denied for S4U on this host, so it is unprobed.
