# Audit Found 3 Silent Hook Bugs; Plan Replaces Most Hooks With Native Features

**Date**: 2026-10-16 16:40
**Severity**: High
**Component**: Rig hook layer (`hooks/`, settings registration, installer)
**Status**: Ongoing (plan written, phases 1-5 pending)

## What Happened

Audited all 15 Rig hooks against current Claude Code docs. Seven get deleted outright (unregistered, dead, or redundant); most of the rest duplicate native CC features. Target: registrations 10 to about 4, roughly 3000 lines removed.

## Impact

We shipped hooks that did nothing and assumed they worked. `post-edit-simplify-reminder` and `plan-format-kanban` ran 114 times and injected zero context. Worse, `descriptive-name` returns `permissionDecision: "allow"` on every Write, so a file-naming helper was bypassing the permission prompt.

## Technical Details

- `session-state`: SessionStart load never runs. Guard requires `hook_event_name`, which CC always sends.
- Two hooks emit top-level `additionalContext`, which CC ignores (only `hookSpecificOutput.additionalContext` counts). Unregistered: `skill-dedup`, `task-completed-handler`, `teammate-idle-handler`. Redundant: `cook-after-plan-reminder`.

## What We Tried

Considered a Rust port of the hook binaries. Rejected: same hook design, no measurable perf gain. Native features first.

## Root Cause Analysis

We wrote hooks without checking the output contract against the docs. Tests asserted the JSON we emitted, never whether CC read it. Green tests, useless hooks.

## Lessons Learned

- Count injections in a live session, not runs. Never return `allow` from PreToolUse unless you mean to bypass the user; policy goes in `permissions.ask` / `deny`. Prefer native features (permissions, statusline `rate_limits`, `.claude/rules/*.md`).

## Next Steps

- Phase 1 (2h): delete the 7 hooks. Phases 2-5 (~9h): native features, installer migration, docs, live verification. Owner: unassigned.

## Unresolved Questions

1. Does `permissions.ask` fire in auto mode? Docs say yes; verify live before phase 2 lands.
