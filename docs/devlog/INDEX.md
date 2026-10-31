# Devlog Index

## Overview
Devlog of shipped work, decisions, failures and lessons learned. Newest first.

## October 2026

- **261030-windows-compatibility-fixes.md**
  - Merged to main, verified on Windows and Linux (WSL2): hook path double-rooting, win32 kill guard (fail closed), skill scripts on Windows, installer cleanup, `.gitattributes` LF pins
  - Review caught a cmd.exe injection in `run_eval` (`shutil.which` resolved `claude.CMD`); fixed with stdin
  - Verified on Windows only; Linux/WSL and macOS still open

- **261028-insights-driven-rig-improvements-plan.md**
  - Planned, not started: 13 phases closing 10 `/insights` gaps (secret-file Bash guard, verify-route, multi-repo ship, remote `dispatch --plan`)
  - Red team: 15 findings, all accepted; 3 Critical fixed in the plan before any code
  - Lesson: check that a mechanism exists before the plan promises it ("one commit per phase" had none)

- **261023-remote-resume-skips-session-less-runs.md**
  - Fixed: `dispatch --resume` read only the last run; a newer `not-started` run (no session) blocked correction rounds
  - Now resumes the newest phase run that has a claude session
  - Lesson: "last item" lookups must skip history entries that lack the needed property

- **261018-remote-per-project-clones-machine-id-check.md**
  - Shipped: one worker holds clones of several projects; `machine-id` check in doctor/setup; per-clone busy markers
  - Strict resolution (`no-clone`, exit 2) over silent fallback to `repo`; legacy markers read-only
  - Review 8.5 → 9.3: empty `repos: {}` silently broke every project; fixed with validation

- **261018-remote-worker-setup-register-and-setup-commands.md**
  - Shipped: `register`, `setup`, worker `prepare` (dedicated clone + baseline), doctor `baseline` check and `fix:` hints
  - Never auto-baselines an existing clone without `--accept-existing-clone`; origin credentials stripped
  - Pre-commit review found a data-loss path (adopting a user's repo); fixed before commit. Live worker run still open

- **261016-replace-hooks-native-features-shipped.md**
  - Shipped (breaking): 11 kit hooks removed, privacy/heavy-dir → `permissions.ask`/`deny`, usage → statusline `rate_limits`
  - Installer strips retired hook registrations; tests asserted our JSON, not what CC consumed
  - Trade-off: Bash `cat .env` no longer intercepted

- **261016-replace-hooks-with-native-features.md**
  - Hook audit: 3 silent bugs (session-state load never runs, top-level `additionalContext` ignored, descriptive-name auto-allows every Write)
  - Plan: delete 7 hooks, privacy/heavy-dir → `permissions.ask`/`deny`, usage → statusline `rate_limits`, naming → rules file
  - Lesson: tests asserted emitted JSON, not what Claude Code actually consumed

- **261015-rig-remote-implementation-and-acceptance.md**
  - `rig:remote` phases 1-6 built; acceptance on real mac, Windows and Linux machines
  - Windows ssh hang on pipe stdio found only on real hardware
  - Lesson: stubs pass, real machines break things

- **261015-rig-remote-multi-machine-plan.md**
  - 7-phase plan (26h) for multi-machine orchestration over SSH, git as the only data channel
  - Red team: 39 findings merged to 15, each decided by the user

## March 2026

- **260328-fix-skill-v2-rewrite.md**
  - `rig:fix` pipeline 5 → 7 steps; replaced "guess all possible root causes" with structured diagnosis

## Reading Guide

### By Topic
- **Hooks and Claude Code integration**: replace-hooks-with-native-features, replace-hooks-native-features-shipped, insights-driven-rig-improvements-plan
- **Multi-machine orchestration**: rig-remote-multi-machine-plan, rig-remote-implementation-and-acceptance, remote-per-project-clones-machine-id-check, remote-worker-setup-register-and-setup-commands, remote-resume-skips-session-less-runs
- **Skills design**: fix-skill-v2-rewrite
- **Windows and cross-platform**: windows-compatibility-fixes, rig-remote-implementation-and-acceptance

### By Lesson Type
- **Why plans succeed**: rig-remote (red team + user decisions before code)
- **Verify against the real system**: rig-remote acceptance, replace-hooks audit
- **Technical debt**: replace-hooks

## Key Patterns Identified

1. **Silent Integration Failure**: Output that looks right to unit tests can be ignored by the host (Claude Code); check transcripts, real machines, live sessions
2. **Real Hardware Finds Real Bugs**: Stubs pass, real machines break things (Windows ssh pipe hang)
3. **Decide Before Code**: Red-team findings decided by the user before implementation keep large plans on track

## Recommendations for Future Planning

- Integration work: include a live verification step against the real host
- Large plans: red-team the plan and get user decisions before phase 1
- All plans: must transition from "Planning" to "Executing" or "Deprioritized" within 72 hours

---

Last updated: 2026-10-31
Total entries: 10
