---
name: rig:team
description: "Orchestrate Agent Teams for parallel multi-session work. Use for research, implementation, review or debug workflows needing independent teammates."
argument-hint: "<research|implement|review|debug> <context> [--devs|--researchers|--reviewers|--debuggers N] [--plan-approval] [--delegate]"
metadata:
  author: rig
  version: "1.1.0"
---

# Agent Teams

**Requires:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (settings.json `env` or shell) and an interactive CLI session. Not for `-p`.

## How teams work now

- No explicit team create or delete step. One implicit team per session; the main session is the lead.
- Spawn a teammate with the `Agent` tool and a `name` (with the flag on, a named agent becomes a teammate). `subagent_type` reuses a Rig agent (`researcher`, `implementer`, `code-reviewer`, `debugger`).
- Message teammates by `name` with `SendMessage` (one per recipient). Idle notices and answers arrive automatically.
- Shutdown: the lead sends a plain-text message asking the teammate to finish and stop; the teammate replies in plain text. Cleanup is automatic at session end.
- Model: a teammate uses its agent definition's `model` (researcher/tester haiku, implementer/debugger sonnet) unless the Agent call passes `model`. Pass `model` explicitly when the task needs a stronger one.

## Workflow

1. If the flag is off or the Agent tool rejects `name`, stop and tell the user to set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. No fallback to plain subagents.
2. Follow the template in `references/team-templates.md`.
3. `TaskCreate` tasks with exclusive file ownership, then spawn 3-5 named teammates (or the flag count) in one message.
4. Monitor via messages and `TaskList`; redirect stuck teammates by name.
5. Synthesize results. `--delegate`: the lead never edits files.

## Rig Context Block

Every teammate spawn prompt MUST end with:

```
Rig Context:
- Work dir: {RIG_PROJECT_ROOT or CWD}
- Reports: {RIG_REPORTS_PATH or "plans/reports/"}
- Plans: {RIG_PLANS_PATH or "plans/"}
- Branch: {RIG_GIT_BRANCH or current branch}
- Naming: {RIG_NAME_PATTERN or "YYMMDD-HHMM"}
- Active plan: {RIG_ACTIVE_PLAN or "none"}
- Commits: conventional (feat:, fix:, docs:, refactor:, test:, chore:)
- Refer to teammates by NAME
- Read `.claude/skills/team/references/team-coordination.md` first: exclusive file ownership, `TaskUpdate` before reporting, on a stop request finish, mark your task done, reply in plain text
```
