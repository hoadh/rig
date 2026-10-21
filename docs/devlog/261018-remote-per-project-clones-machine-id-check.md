# rig:remote Per-Project Worker Clones, Machine-ID Check, Per-Clone Run Lock

**Date**: 2026-10-18 15:06
**Severity**: Medium
**Component**: rig:remote worker and orchestrator (`.claude/skills/remote/scripts/`)
**Status**: Shipped (commit 12bacc0; live two-worker run not yet done)

## What Happened

Shipped plan 261018-1155 phases 01-03 in one commit. One worker OS user can now hold a clone of several projects and run them in parallel. `doctor` and `setup` fail when the worker's `RIG_MACHINE` does not match its registry name. Phase 04 docs, ADR 0002 amendment, changelog and roadmap went in the same commit (40 files, +771/-110).

## Impact

Before this, a worker had one `repo`. A second project either ran in the wrong clone or collided on `agent.busy`. Old workers keep working: the orchestrator always sends one resolved target, so `repos` never reaches the worker.

## Technical Details

- Worker `info` reply adds `machine`. Check id `machine-id`: fail on mismatch, warn when absent (older worker). Setup stops before `prepare`.
- Registry gains optional `repos: { "<normalizeOrigin(origin)>": "<abs path>" }`. `repo` stays required.
- Resolution is strict: `repos[key]`, else `repo` only for legacy entries or when cwd has no origin, else exit 2 `no-clone`.
- Busy markers are per clone: `<kind>-<cloneHash>.busy`. Legacy `agent.busy` and `test.busy` are read-only during transition.
- Review scored 8.5, then 9.3 after three Medium fixes: `repos: {}` broke every project; `/c-rig-test` nested beside `/c` was accepted; `forceFinalize` threw `TypeError` on a `run.json` without `target`.
- Tests: 60/60 files green. Two live e2e suites are opt-in and were skipped.

## What We Tried

- Fallback to `repo` when the project is missing from `repos`. Rejected: a project could silently share another's clone. The planner proposed it; the user overrode it.
- Resolution on the worker. Rejected: orchestrator-side resolution keeps old workers untouched.

## Root Cause Analysis

The single-`repo` model assumed one project per worker. The busy lock keyed on kind alone, so a second project looked busy even on a different clone.

## Key Decisions

- **Strict resolution over fallback.** Cost: a registry with a `repos` map needs an entry for every project, and missing entries fail loudly.
- **Orchestrator resolves, worker gets one repo.** Cost: resolution logic lives on the orchestrator only.
- **Legacy busy markers honored read-only.** Cost: a live legacy run blocks other projects on that worker until it ends.
- **No remove-project command.** Cost: users hand-edit the registry, documented in `registry-format.md`.

## Lessons Learned

- Setting `GIT_SSH_COMMAND=false` in tests was needed: `doctor` ran `ls-remote` against the network.
- Tests must run the CLI from temp git repos. The rig repo has its own `origin`, so tests run inside it resolve the wrong project.
- Validate collections that users can empty. `{}` passed validation and silently disabled every project.

## Next Steps

- Owner: user. Decide whether to write the two-origin loopback e2e now or drop it. Target: before the next release.
- Owner: next maintainer. Drop legacy busy-marker reads in the next minor, once no worker runs pre-12bacc0 Rig.

## Unresolved Questions

1. Should `doctor` with no args fail or warn on machines that lack this project's clone? Currently fails, which is noisy for machines used only by other projects.
2. Should `register` block two projects sharing one clone path? Currently `doctor` catches it later.
3. `realpathSync` is not `.native`, so case variants of one path on macOS/Windows hash differently and can bypass same-clone serialization. Defer or migrate?
4. No coverage tool in the suite, so the "80%+" criterion is unverified.
