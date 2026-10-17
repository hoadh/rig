# Devlog Index

## Overview
Devlog of shipped work, decisions, failures and lessons learned. Newest first.

## October 2026

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
- **Hooks and Claude Code integration**: replace-hooks-with-native-features, replace-hooks-native-features-shipped
- **Multi-machine orchestration**: rig-remote-multi-machine-plan, rig-remote-implementation-and-acceptance
- **Skills design**: fix-skill-v2-rewrite

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

Last updated: 2026-10-17
Total entries: 5
