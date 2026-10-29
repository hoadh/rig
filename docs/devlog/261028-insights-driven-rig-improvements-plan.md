# Insights-Driven Rig Improvements: 13-Phase Plan

**Date**: 2026-10-28 15:49
**Severity**: High
**Component**: Rig core (hooks, `settings.json` permissions, skills implement/git/browser/remote/docs, agents)
**Status**: Planned (nothing implemented or committed; wave 1a gated on a user probe)

## What Happened

Plan only, nothing shipped. The user ran `/insights` (69 sessions) and asked how to improve Rig. Analysis found 10 gaps (P1 1-4, P2 5-7, P3 8-10). `/rig:plan --parallel` turned them into 13 phases in `plans/261028-1101-insights-driven-rig-improvements/plan.md`: wave 1a = 10 phases in parallel, 1b = 07, G2 = 12, G3 = 13; 14 commits on `feat/insights-improvements`.

## Impact

Gaps closed once shipped:
- Bash reads of secret files (`cat .env`) skip `permissions.ask`. `261016-replace-hooks-native-features-shipped.md` dropped that intercept.
- UI changes pushed unverified (Chrome extension disconnected in 4+ sessions).
- Overconfident changes shipped (wrong subagent status flows; PM2 pointed at a `~/.nvm/current` symlink, prod outage).

Risk: the guard emits `ask`, which one upstream report (anthropics/claude-code#77212, VS Code build) says bypass mode auto-approves. Verified on Claude Code 2.1.312 headless (`-p`): `ask` beats allow rules and `acceptEdits`; timeout = fail-open. `ps` showed three live `--dangerously-skip-permissions` sessions; global `defaultMode` is `auto`. If `ask` fails there, the guard is inert. Runner logs (user-run 2026-10-28, 2.1.312, `reports/ask-probe/results/<mode>/`): hook `ask` honored in interactive `auto` (prompt shown) and in headless `--dangerously-skip-permissions` (ask = denial), as in headless default/auto and interactive default; hook `deny` blocks in all of them. Two earlier verbal reports (bypass and interactive auto ignore `ask`) did not reproduce. Native `permissions.ask` rules also override interactive auto (`Ask rule Bash(cat *) overrides auto mode`, `results/auto-interactive-rule/`). Interactive bypass: the hook `ask` prompts and `deny` blocks there too (`results/bypass-interactive*/`); the first two probe sessions stalled before any tool call (recorded INCONCLUSIVE), the rerun with a longer wait and full debug log answered in 2 s. With global `defaultMode: auto`, the guard is active in this user's everyday sessions.

## Red Team and Validation

- Red team: 4 reviewers, 39 raw findings, deduped to 15 (3 Critical, 9 High, 3 Medium). All accepted; 6 with modifications.
- Critical draft flaws:
  - Per-phase commits had no mechanism: `grep -ci commit implementer.md` = 0; only commit path was `git add -A` (`git/SKILL.md:55`).
  - `hooks.secretFileBashGuard: false` in cwd `.claude/.rig.json` merged over global (`rig-config-utils.cjs:488-489`): any agent could disable the guard.
  - `ship` scanned the working-tree diff only; committed secrets would push unscanned.
- Validation (4 questions, recommended options): feature branch, not `main`; five `permissions.ask` entries; no version bump; opt-out gates (missing `gates:` = `[push, secrets, destructive-git]`).

## Key Decisions

- **Ask-only guard; `.env` rules unchanged, nothing in `deny`.** Cost: prompts on every matching command; log-backed in interactive auto/bypass (hook ask prompts, native ask rules override auto) and headless bypass (ask = denial), 2026-10-28; no `deny` fallback by decision.
- **Implementers never run git; orchestrator commits serially.** Cost: slower waves. Gain: one bisectable commit per phase.
- **Approval = main-session `AskUserQuestion` answer, logged in `progress.md`.** Agent messages never count.
- **Ship inlines secret regexes.** Works in `.agent/`, which has no `hooks/lib`. Cost: duplicated patterns.
- **Scope held.** Unrequested changes (8 doc drift fixes, `git` merge/force edits) moved to follow-ups.
- **Rejected:** phase merging, `deny` verbs, `--wait` instead of a sequencer, `Monitor` matcher, worktree-per-phase default (01 and 07 share `settings.json`).

## Root Cause Analysis

The draft assumed a mechanism the repo lacked and missed trust boundaries (agent-writable toggle, pushed history). Its acceptance could not fail: negative greps passed on missing files, and `npm test` exits 0 with 8 puppeteer tests skipped.

## Lessons Learned

- Grep the code for each mechanism a plan depends on before the plan promises it.
- Acceptance must be able to fail: behavioral probes, not presence greps.
- A verdict is a file, not a verbal report. Two verbal verdicts (bypass and interactive `auto` ignore `ask`) were recorded as fact, then contradicted by the runner's own logs (`hook-log.txt`, `screen.txt`, `verdict.txt`). Probe the exact mode in question: interactive bypass was never covered, so `bypass-interactive` was added before trusting any claim about it; its first two runs stalled before any tool call and were recorded as INCONCLUSIVE, not as a verdict; the rerun (longer wait, full debug log) gave ENFORCED.

## Next Steps

- **User**: optional `PROBE_KIND=rule plans/261028-1101-insights-driven-rig-improvements/reports/ask-probe/run.sh bypass-interactive` (native ask rule under interactive bypass); every hook-mode probe is done. Phase 01 later ships the checked-in `live-ask-probe.sh` for re-runs with the real guard.
- **Orchestrator**: after the probe passes, `git checkout -b feat/insights-improvements main`, then `/rig:implement --parallel` on the plan.
- **User**: after wave 13, approve the push gate; ff-merge and push only on that explicit approval.

## Unresolved Questions

1. Untested: native `permissions.ask` rules under interactive bypass (`PROBE_KIND=rule ./run.sh bypass-interactive`); approval persistence under `ask`; why the first two bypass sessions stalled (the reruns did not). Verified: hook `ask` in interactive default/auto/bypass and headless default/auto/bypass (headless ask = denial); hook `deny` in headless default/bypass and interactive auto/bypass; native ask rule overrides interactive auto. Phase 07 unknowns: `claude auth status` inside a hook, gh/clasp exit codes, Windows `.cmd` shims.
