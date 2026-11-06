---
name: rig:progress
description: "Track progress from plan phase tables, todo checkboxes and LIVE items; update plan statuses and report. Use for status checks and plan completion."
argument-hint: "[task: status, sync, report]"
metadata:
  author: rig
  version: "1.0.0"
---

# Progress Tracking

Project oversight and coordination. Plan files (phase tables, todo checkboxes, `LIVE:` items) are the source of truth; the Tasks API is optional.

**Principles:** Token efficiency | Concise reports | Data-driven insights

## When to Use

- Checking project status or progress across plans
- Updating plan statuses after feature completion
- Syncing plan files with completed work (and with Tasks, when the Tasks API is in use)
- Generating status reports or summaries
- Coordinating documentation updates after milestones
- Verifying task completeness against acceptance criteria
- Cross-session resume of multi-phase work

## Source of Truth

Read progress from the plan files themselves:
- `plan.md` phases table (`| Phase | Name | Status |`) and YAML frontmatter
- `- [ ]` / `- [x]` todo checkboxes in each `phase-XX-*.md`
- `## Pending Live Verification` items (`- [ ] LIVE:` / `LIVE(blocking):`), reported separately and excluded from progress %

The Tasks API (`TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`) is off by default in current Claude Code. Use it only if `TaskCreate` is available; otherwise track everything in the phase files. Everything below works either way.

## Core Capabilities

### 1. Task Operations (optional)
Load: `references/task-operations.md` only when the Tasks API is available.
- Create tasks with metadata (phase, priority, planDir, phaseFile), track `pending` -> `in_progress` -> `completed`
- Coordinate parallel agents with scoped ownership

### 2. Sync-Back
Reconcile completed work against all phase files, update `[ ]` -> `[x]`, update phases table and YAML frontmatter status. If tasks exist, map each completed task to its `phase` / `phaseFile` first. Next session resumes from the remaining `[ ]` items.

### 3. Progress Tracking
Load: `references/progress-tracking.md`

- Scan `./plans/*/plan.md` for active plans
- Parse YAML frontmatter for status, priority
- Count `[x]` vs `[ ]` in phase files for completion %
- Cross-reference completed work against planned tasks
- Verify acceptance criteria met before marking complete

### 4. Documentation Coordination
Load: `references/documentation-triggers.md`

Trigger `./docs` updates when:
- Phase status changes, major features complete
- API contracts change, architecture decisions made
- Security patches applied, breaking changes occur

Delegate to `docs-maintainer` subagent for actual updates.

### 5. Status Reporting
Load: `references/reporting-patterns.md`

Generate reports: session summaries, plan completion, multi-plan overviews.
- Use naming: `{reports-path}/pm-{date}-{time}-{slug}.md`
- Sacrifice grammar for brevity; use tables over prose
- List unresolved questions at end

## Workflow

```
[Scan Plans] → [Track Progress] → [Update Status] → [Generate Report] → [Trigger Doc Updates]
```

1. Scan `./plans/*/plan.md`: phases table, todos, `LIVE:` items
2. If tasks exist (`TaskList` available), reconcile them with the phase files
3. On completion: run full-plan sync-back (all phase files, including backfill for earlier phases), then update the phases table and YAML frontmatter
4. Generate status report to reports directory
5. Delegate doc updates if changes warrant

## Mandatory Sync-Back Guard

When updating plan status, NEVER mark only the currently active phase.

1. Sweep all `phase-XX-*.md` files under the target plan directory.
2. If tasks exist, reconcile every completed task to phase metadata (`phase` / `phaseFile`).
3. Backfill stale checkboxes in earlier phases before marking later phases done.
4. Update `plan.md` status/progress from real checkbox counts.
5. If any completed task or step cannot be mapped to a phase file, report unresolved mappings and do not claim full completion.
6. Live-verification guard: NEVER set a phase `Completed` (plan.md table or phase frontmatter), nor plan `status: completed`, while its `## Pending Live Verification` section has unchecked `- [ ] LIVE:` / `LIVE(blocking):` items. Keep/set `In Progress` and list the open items under "Awaiting live evidence" in the report. Do not backfill `LIVE:` checkboxes. Tick one only when evidence is recorded as a pointer under it (host, log path, UTC time, count/hash); raw excerpts need user approval. Open `LIVE:` items do not block dependents; `LIVE(blocking):` items do.

## Plan YAML Frontmatter

All `plan.md` files MUST have:

```yaml
---
title: Feature name
status: in-progress  # pending | in-progress | completed
priority: P1
branch: feature-branch
tags: [auth, api]
created: 2026-02-05
---
```

Update `status` when plan state changes.

## Quality Standards

- All analysis data-driven, referencing specific plans and reports
- Focus on business value delivery and actionable insights
- Highlight critical issues requiring immediate attention
- Maintain traceability between requirements and implementation

## Related Skills

- `rig:plan` — Creates implementation plans (planning phase)
- `rig:implement` — Implements plans (execution phase, invokes progress-tracker at finalize)
