---
name: team
description: "Orchestrate Agent Teams for parallel multi-session work. Use for research, implementation, review or debug workflows needing independent teammates."
argument-hint: "<research|implement|review|debug> <context> [--devs|--researchers|--reviewers|--debuggers N]"
metadata:
  author: rig
  version: "2.0.0"
---

# Agent Teams

**Requires:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and an interactive session (`-p` never spawns teammates).

Claude Code runs the team (mailbox, idle notices, shutdown, plan approval, task list, panel). Rig picks the agent per role; its hooks give each in-process teammate the Rig context, role skill and team rules. Do not rebuild native parts.

## Workflow

1. Check the flag: `echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is `1` (or settings `env`). Off: stop and tell the user; a named Agent call without it is only a plain subagent. After the first spawn, `~/.claude/teams/session-<8>/config.json` must list the teammate.
2. Pick the template in `references/team-templates.md`. Plan-first: the user puts the lead in plan mode (Shift+Tab) before spawning; those teammates plan first, Claude Code approves their plans itself (no lead review), then they edit in Manual mode (prompts in the lead). Leave plan mode before testing and merging.
3. Split the work into tasks with disjoint files (`Files: src/api/*`). If `TaskCreate` is available (newer models: `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`), add them to the shared list, 5-6 per teammate; otherwise each spawn prompt carries its task.
4. Spawn 3-5 teammates in one message: `Agent` with `name`, `subagent_type: rig:<agent>`, a task prompt ending with the Rig Context Block. Never pass `isolation` (makes a plain subagent) or `mode` (not supported per teammate).
5. While they work, do not edit their files; answer messages, redirect by name.
6. After they report: merge, run the tests, fix what is left, synthesize (unresolved questions last).
7. Ask each teammate to shut down (native shutdown request).

## Rig Context Block

```
Rig Context:
- Work dir: {RIG_PROJECT_ROOT or CWD}
- Reports: {RIG_REPORTS_PATH or "plans/reports/"}; plans: {RIG_PLANS_PATH or "plans/"}
- Branch: {RIG_GIT_BRANCH}; active plan: {RIG_ACTIVE_PLAN or "none"}
- Your task: {task}; your files: {globs}
```

Limits: split-pane teammates miss the Rig hook context; with the flag on, any named subagent is a teammate; `/resume` does not restore teammates. Rules: `references/team-coordination.md`.
