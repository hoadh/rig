# Task Tracking in Rig Skills

Rig's progress state lives in plan files. Claude Code's Tasks API (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) is optional and off by default. Skills use it only when it is available.

## Source of truth

| Layer | What | Lifetime |
|-------|------|----------|
| Plan files | `plan.md`, `phase-XX-*.md` status and `[ ]` / `[x]` checkboxes | Persistent, in the repo |
| Claude Tasks | Session task list with dependencies | Ends with the session |

A new session does not rebuild tasks from the plan. It reads the unchecked `[ ]` items in the phase files and resumes from there. Planning creates tasks only when `TaskCreate` is available.

## Which skills reference the Tasks API

| Skill | Use |
|-------|-----|
| `rig-plan` | Optional task creation after the phase files are written |
| `implement` | Tasks if available, otherwise phase files |
| `fix`, `rig-debug`, `test` | Optional step tasks with dependencies |
| `progress` | Reconciles completed work with phase files; reconciles tasks too when the API is available |
| `team` | Shared task list for teammates (Agent Teams) |

Every skill works with the Tasks API off. Phase files are the record.

## Removed in 1.1

The 1.0.0 hydration workflow (`hydration-workflow.md`) is gone. Plans are no longer copied into tasks at session start.

## Details

- Task operations, metadata and reporting: `.claude/skills/progress/references/task-operations.md`
- Planning and phase-file rules: `.claude/skills/rig-plan/references/task-management.md`
- Agent and skill authoring rule on the Tasks API: [authoring standards](./agent-skill-hook-authoring-standards.md)
