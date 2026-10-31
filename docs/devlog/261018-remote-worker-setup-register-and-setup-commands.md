# rig:remote Worker Setup: `register`, `setup`, `prepare`, Doctor Fix Hints

**Date**: 2026-10-18 11:43
**Severity**: Medium
**Component**: rig:remote orchestrator and worker (`.claude/skills/remote/scripts/`)
**Status**: Shipped (commit 818efa4, plan 261018-1110 marked completed; no live worker run recorded)

## What Happened

Shipped plan 261018-1110 in one commit (22 files, +844/-21). Worker preparation (stage 1, before `/rig:plan`) is now a command set instead of hand edits:

- `register <id> --ssh --os --repo ...` writes one validated registry entry. Atomic write, refuses overwrite without `--replace`, rejects secret keys.
- `setup <machine...> [--accept-existing-clone]` runs the ssh/node/claude probe, the Rig protocol check, worker `prepare`, then `doctor`.
- Worker `prepare` creates the dedicated clone from the orchestrator's origin and records the known-good baseline and git identity.
- `doctor` gains a `baseline` check and a `fix:` line under every failed or warned check.
- Docs: worker setup guide, how-to, registry format, changelog, roadmap.

## Impact

A worker can be prepared and checked from the orchestrator in one run. Doctor failures now name the next step. Installing Rig, ssh keys and `claude` login stay manual: setup prints the exact fix instead of doing them.

## Technical Details

- Clone refusals: non-git dir, dirty tree, foreign origin, quarantined clone. With `--accept-existing-clone`, also unpushed commits (`git log --branches --not --remotes`) and stash entries.
- Refusal text, e.g. `<repo> exists and is not a git clone`, is now split from real git errors (`cannot inspect local branches/stash: ...`).
- `stripUrlCredentials` bug: `https://u:p@ss@host` leaked `ss@host` into the worker's `.git/config`. Fixed; ssh URLs keep the user and drop only the password.
- Partial clone is discarded on failure so a rerun starts clean.
- Tests added for the register writer, doctor checks, fix hints, bootstrapper, setup transport and redaction. The plan records no test run result, so none is stated here.

## Key Decisions

- **Never auto-baseline an existing clone.** Rejected: adopting whatever sits at the path, since the clone is reset on every run. Cost: hand-made clones need `--accept-existing-clone`.
- **Strip credentials from the origin URL before sending it to the worker.** Cost: workers need their own git auth (ssh key or credential helper).
- **No remote install of Rig, ssh keys or claude login.** Rejected: out of reach from the orchestrator without a trust decision. Cost: each worker still needs manual steps; setup prints them.
- **Extend `rig:remote`, no new skill.** Shares registry, ssh and baseline libs; Antigravity excludes remote anyway.

## Lessons Learned

- The pre-commit review of the uncommitted change (archived in `plans/archive/261018-1110-remote-worker-setup/reports/`) found 2 High and 5 Medium issues. The most serious: `--accept-existing-clone` would adopt a user's own repo and reset it, destroying unpushed commits and stashes. The commit adds the unpushed/stash refusal, and the partial-clone cleanup and error-text split.
- Review before the first commit. Data-loss paths are cheap to fix before they ship.

## Next Steps

- Owner: unassigned (plan has none). Run `setup` against one real ssh worker and record the result in the devlog. Before the next release.
- Owner: unassigned. Decide on the registry lock (see below).

## Unresolved Questions

1. `machine-registry-writer.cjs` still has no lock: concurrent `register` calls can lose an update, and a failed `rename` leaks the `*.pid.tmp` file. Fix or accept?
2. Two review items are not confirmed in code: fail-early on a local or unclonable origin (review #7), and quoting paths with spaces in fix hints (review #10).
3. Two orchestrators running `setup` on one worker have no worker-side lock (review #12). Accept?
