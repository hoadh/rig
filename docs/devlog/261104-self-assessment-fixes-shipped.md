# Self-Assessment Weakness Fixes: Implementation Shipped

**Date**: 2026-11-04 18:51
**Severity**: High
**Component**: CI and test discovery, lint, Bash safety guard (secret-file reads), always-loaded rules, benchmark harness, docs
**Status**: Shipped on `feat/self-assessment-fixes` (not pushed, not merged). Plan 261104-1427 stays In Progress until live items close.

## What Happened

Five of seven phases of plan 261104-1427 shipped in 8 commits (`f81b765`..`fc2c815`): CI with real tests and lint, a Bash secret-file read rule, size tiers with rewritten rule tone, and a 36-run Rig vs vanilla benchmark. P4 (installer dedupe) and P5 (skill packs) were cancelled by the user; the Rig 2.0 plugin (plan 261104-1426) supersedes them. The benchmark showed no quality gain from Rig on this task set.

## Impact

- CI runs lint, all node suites (test discovery 29 → 103 files), eval tier 1 and pytest. Previously most suites never ran in CI.
- ESLint found 381 errors; all fixed with no behavior change.
- Always-loaded rules fell from 25,603 to 13,042 bytes (-49%). Trivial and standard tasks spawn 0 subagents.
- Bash guard asks before `cat`, `grep`, `source`, `cp` or `curl @file` touch secret files. A seatbelt, not a sandbox.
- Cost: Rig is ~1.5x vanilla per run (median $0.41 vs $0.27). The benchmark cost $14.23 in total.

## Technical Details

- Benchmark: Rig 18/18 hidden-test passes vs vanilla 17/18. The one miss was a vanilla run on the path-traversal task (3/4 tests). n=3 per cell; no significance claim.
- Overhead is a fixed ~$0.13-0.15 per run on tasks 1-5, consistent with always-loaded context. Large task: Rig median 163 s vs vanilla 99 s.
- `http-server.test.cjs` (covers `isPathSafe`) was skipped in CI as "bun:test-style". It is a custom-framework suite, and the skip exited 0.
- Secret-read review (7.5/10, H1): heredoc bodies were scanned as words. `git commit -F - <<'EOF'` with `fix: do not log .env` prompted. Headless `ask` is denial, so headless commits would fail. Fixed in `7f9e9eb`.
- CI review (8/10, High): Antigravity sync check would have gone red (45 files drifted). Fixed by syncing in `40ca3e1`.

## Root Cause Analysis

CI gave false green. Skip reasons were wrong, and skips exited 0. Stale media and markdown-viewer dashboard tests failed, which hid security tests in the same run. Lint never ran in CI, so 381 errors accumulated. The guard's tokenizer treated prose inside a heredoc as shell commands.

## Key Decisions

- Secret-read rule uses `ask`, not `deny`. Trade-off: headless runs treat it as denial.
- Size tiers replace planner-for-everything. Trade-off: the large-tier research path is unconfirmed live.
- Published the unfavorable benchmark as is. Cancelled P4/P5 rather than build an installer the plugin replaces.

## Lessons Learned

- Cost overhead (~1.5x) with no measured quality gain is the current evidence. The fixture is too easy (18/18 vs 17/18 cannot separate arms). Build harder, multi-session tasks before claiming value.
- A skip that exits 0 is a hidden failure. Audit skip maps and print skip reasons in CI.
- Test guards against prose in commit messages and doc writes, not only attack strings.

## Next Steps

- **Alex (before merge):** push the branch and confirm CI green on Linux.
- **Alex:** confirm Windows and macOS matrix legs.
- **Alex:** run the interactive `ask` probe for the secret-read rule.
- **Alex:** confirm the large-tier research path in a real session.
- **Alex (per release):** add harder benchmark tasks; re-run and track cost.
- **Plan 261104-1530:** cut always-loaded context further.

Benchmark details: `scripts/benchmark/results/2026-11-04/summary.md`.

## Unresolved Questions

1. Do the CI matrix legs pass on push? Not yet run.
2. Does headless `ask` unfairly block the Rig arm? Permission denials were similar (31 vanilla vs 37 Rig), so unclear.
3. Is the large-tier research path reached and useful in a real session?

**Status:** Shipped on branch; pending CI, live probes and merge.
