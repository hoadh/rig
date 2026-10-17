# Claude Code Concepts in Antigravity

The rules, skills, workflows and agent files in `.agent/` are generated from Rig's Claude Code kit (`.claude/`). They still name Claude Code tools and features. Read them through this mapping.

## Tools

| Text says | Do this in Antigravity |
|---|---|
| Delegate to the `<name>` agent, spawn a subagent, `Task(...)`, `Agent(...)` | Read `.agent/agents/<name>.md` and do that role yourself, step by step. For independent work that can run in parallel, the user may start separate agents from the Agent Manager. Write the same report files the agent would write. |
| `AskUserQuestion` | Ask the user in chat. List the options, mark the recommended one, and wait for the answer. |
| `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite` | Track steps in your own task list. Plan files in `plans/` stay the source of truth. |
| `Skill` tool, "activate the `<name>` skill", `/<name>` | Read `.agent/skills/<name>/SKILL.md` and follow it. |
| `$ARGUMENTS` | The text the user typed after the workflow command. |
| `SendMessage`, Agent Teams | Not available. Do the work sequentially. |

## Context that hooks used to inject

Claude Code hooks inject `## Plan Context`, `## Naming`, the plan directory and the reports path. Antigravity has no hooks, so use these defaults:

* New plan directory: `plans/{YYMMDD-HHmm}-{slug}/`
* Reports: `{plan-dir}/reports/` when a plan is active, otherwise `plans/reports/`
* Report file name: `{type}-{YYMMDD-HHmm}-{slug}.md`, where `type` is the role (researcher, reviewer, debugger, tester, ...)
* Skip steps that run `set-active-plan.cjs` or any script under `~/.claude/scripts/` or `.claude/hooks/`.

## Guards that hooks used to enforce

* **Privacy:** do not read `.env` files (except `.env.example`), private keys, credential files or token stores. If a task needs one, ask the user first and say why.
* **Scope:** do not list or search inside `node_modules`, `.venv`, `dist`, `build`, `.git`, `vendor` or `__pycache__` unless the user asks.

## Claude Code-only features

* `claude -p`, Claude model names (opus, sonnet, haiku) and Claude Code settings do not apply. When a skill step needs `claude -p` (for example the description optimizer in `create-skill`), skip that step and tell the user.
* `rig:remote` and `rig:team` are not included in `.agent/`.
* Paths under `~/.claude/` point to Claude Code user files. Skills and scripts here live in `.agent/skills/`.
* API keys for skill scripts (for example `GEMINI_API_KEY` for `media`) are read from environment variables first.
