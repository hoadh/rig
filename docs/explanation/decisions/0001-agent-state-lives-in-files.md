# ADR 0001: Agent State Lives in Files

**Status**: Accepted
**Date**: 2026-10-15
**Extended by**: [ADR 0002: Multi-machine remote orchestration](./0002-multi-machine-remote-orchestration.md) (git as transport; state stays in files)

## Context

Each agent invocation in Claude Code starts with a fresh context. Subagents get only the prompt the main agent writes ([orchestration protocol](../../../.claude/rules/orchestration-protocol.md)), and a session ends when the user closes it or the context is compacted. Something has to carry work across those boundaries: which plan is active, which phases are done, what a researcher found.

The open question was whether agents should keep state somewhere other than the file system: a database, a background service, an MCP memory server, or a vector store.

Rig already runs on files in practice:

| State | Where | Lifetime |
|---|---|---|
| Plans, phase status, todo checkboxes | `plans/<plan>/plan.md`, `phase-*.md` | Durable, in the project |
| Agent handoffs (research, review, test results) | `plans/<plan>/reports/`, `plans/reports/` | Durable, in the project |
| Docs, changelog, roadmap | `docs/` | Durable, committed |
| Devlog | `docs/devlog/` | Durable, committed |
| Active plan for the session | `$TMPDIR/rig-session-<id>.json` (`set-active-plan.cjs`) | One session |
| Progress tracking | Claude Tasks, hydrated from phase files | One session |
| Caches (git info, usage limits, notification throttle) | `$TMPDIR/rig-*.json` | Disposable |

## Decision

Agent state stays in files. No database, daemon, or memory server is added.

- **Durable state** is markdown under `plans/` and `docs/`. These files are the source of truth. Anything that must survive a session goes there.
- **Session state** is a small JSON file in the OS temp dir, keyed by session ID and written atomically (temp file + rename). Losing it costs nothing that a plan file cannot restore.
- **Claude Tasks are a view**, not a store: they are rebuilt from phase files at the start of work and synced back to them at the end.
- **Caches** in the temp dir hold only data that can be recomputed.

## Consequences

**Benefits**

- Nothing to install or run: Rig stays a copy of `.claude/` plus Node.js.
- People and agents read the same files. A user can open, edit, or `git diff` a plan, and a new session or a different agent picks it up without a migration.
- State travels with the repo and works in git worktrees, so `/rig:team` devs each see the plan on their own branch.
- Compaction and crashes are survivable: the next session rereads the plan.

**Costs**

- No queries across plans; finding work means scanning directories (`plans/` frontmatter, `blockedBy`/`blocks`).
- No locking. Two sessions editing the same plan file can overwrite each other; worktree isolation and file ownership rules in `team-coordination-rules.md` are the only guard.
- Free-form markdown can drift from the format hooks expect; validators (`validate-docs.cjs`, plan format checks) catch part of it.
- Temp-dir state is per machine and is cleared by the OS; that is accepted because it holds nothing durable.

## Alternatives Considered

- **SQLite or JSON store in the project**: queryable and lockable, but opaque to people reading the repo, adds a schema to migrate, and duplicates what plan files already hold.
- **MCP memory server or vector store**: useful for fuzzy recall, but adds a running dependency and setup, and its contents are not reviewable in a diff. Users who want one can still add it as an MCP server; Rig does not depend on it.
- **Background service holding state in memory**: would allow real-time coordination, but contradicts the "copy `.claude/` and go" install model and dies with the process.

## Revisit When

- Several people need to run agents on the same plan at the same time and worktrees are not enough.
- Plan count grows to where scanning `plans/` is noticeably slow.
- Claude Code adds a native, durable cross-session store that hooks can read.
