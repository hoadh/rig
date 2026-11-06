# Devlog Index

## Overview
Devlog of shipped work, decisions, failures and lessons learned. Newest first.

## November 2026

- **261106-rig-2-plugin-beta-implemented.md**
  - Rig 2.0 plugin packaging (plan 1426) implemented, draft PR #4, CI green on 3 OSes; beta tag and LIVE checks pending
  - rig-init migrator: journaled moves into backups, resume, restore, terminal-only consent gate
  - Reviews per phase found a never-accepting prompt and a one-command consent bypass; fixed with pty and ancestry tests
  - Lesson: plugin bin/ is on the Bash tool PATH only; print absolute commands for the user's terminal

- **261106-rig-1-1-context-reduction-shipped.md**
  - Rig 1.1 (plan 1530) implemented, PR #2, CI green on 3 OSes; released as v1.1.0
  - One budget-tested `core-rules.md`; task rules moved into skills; delta UserPromptSubmit
  - Removed sequential-thinking, notifications, output styles; 510 dead tool refs to 0; guard scans added
  - Lesson: size budgets must count repo bytes, not CRLF checkout bytes

- **261106-cross-platform-ci-fixes.md**
  - First full macOS/Windows CI run: 1 macOS + 11 Windows test files failed; fixed in PR #1, CI green on 3 OSes
  - Real bugs: rig:remote rejected valid worktrees under 8.3 short paths (now `realpathSync.native`); tokenizer left absolute `cd` unresolved
  - Rest were POSIX-only test assumptions (tmp realpath, CRLF, separators, `/etc/passwd`, sh fake git)
  - Lesson: build expected paths like the code does; rerun base branch before blaming a branch (2 flaky remote tests)

- **261104-claude-code-native-alignment-plan.md**
  - Planned, not started: 1.1 cleanup (plan 1530) then 2.0 plugin packaging (plan 1426), from the Claude Code changelog review
  - Found broken: `team` (TeamCreate removed), Tasks API hydration silently skipped, double-loaded rules on global+project installs
  - Red team: 15 findings (7 Critical), all accepted; release split after red team; 1427 P4/P5 cancelled
  - Lesson: link overlapping plans across sessions and worktrees in both directions straight away

- **261104-self-assessment-fixes-shipped.md**
  - Shipped on `feat/self-assessment-fixes`, merged to `main`: CI runs lint and all suites, 381 lint errors fixed, secret-file Bash read rule, size tiers (always-loaded rules 25.6KB → 13.0KB), 36-run benchmark
  - Benchmark: Rig 18/18 vs vanilla 17/18 hidden tests, Rig ~1.5x cost ($14.23 total); no quality gain shown, tasks too easy
  - P4 installer dedupe and P5 skill packs cancelled; superseded by Rig 2.0 plugin (plan 261104-1426)
  - Lesson: a skip that exits 0 hid broken security tests; heredoc prose was tokenized as commands

- **261104-verification-and-safety-guards-shipped.md**
  - Shipped on `feat/verification-guards`, merged to `main`: Stop completion-evidence guard, Bash safety guard (pkill self-match, symlink edit), git push proof, debug evidence, Pending Live Verification
  - Review 7/10 → 8/10 → 8/10; C1 `$PRE` lost across Bash calls made every commit look "committed"; ReDoS shape checker replaced by `vm` 250 ms timeout
  - Dogfooding found what tests did not: load-flaky latency test, same-command symlink bypass
  - Lesson: verified-by-ran is not verified-by-passed; per-call shell state is invisible to single-shell tests

- **261104-verification-and-safety-guards-plan.md**
  - Planned, not started: 5 phases closing 8 `/insights` items (Stop completion-evidence guard, Bash safety PreToolUse guard, push proof, live-verification status)
  - Red team: 15 findings, all accepted; 2 Critical fixed in the plan before any code (verify guard credited failing commands; transcript assumed flushed at Stop)
  - Dropped the planned hosts registry for an `ssh -G` rule (registry would break older builds and duplicate `~/.ssh/config`)
  - Lesson: same as 261028, mechanisms the plan assumes must be grepped first

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
- **Hooks and Claude Code integration**: replace-hooks-with-native-features, replace-hooks-native-features-shipped, insights-driven-rig-improvements-plan, verification-and-safety-guards-plan, verification-and-safety-guards-shipped
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

Last updated: 2026-11-04
Total entries: 12
