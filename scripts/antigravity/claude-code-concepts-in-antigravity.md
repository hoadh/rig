# Claude Code Concepts in Antigravity

The rules, skills, workflows and agent files in `.agent/` are generated from Rig's Claude Code plugin (`plugins/rig/`). They still name Claude Code tools and features. Read them through this mapping.

## Tools

| Text says | Do this in Antigravity |
|---|---|
| Delegate to the `<name>` agent, spawn a subagent, `Agent(...)` | Read `.agent/agents/<name>.md` and do that role yourself, step by step. For independent work that can run in parallel, the user may start separate agents from the Agent Manager. Write the same report files the agent would write. |
| `AskUserQuestion` | Ask the user in chat. List the options, mark the recommended one, and wait for the answer. |
| `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite` | Track steps in your own task list. Plan files in `plans/` stay the source of truth. |
| `Skill` tool, "activate the `<name>` skill", `/<name>` | Read `.agent/skills/<name>/SKILL.md` and follow it. |
| `$ARGUMENTS` | The text the user typed after the workflow command. |
| `SendMessage`, Agent Teams | Not available. Do the work sequentially. |

## Plugin features with no Antigravity equivalent

Rig for Claude Code ships as a plugin. These parts of it do not exist in `.agent/`:

* **The plugin itself:** its manifest, marketplace entry, install, update and migration commands. `.agent/` is a plain directory in the repo; update it by running the sync script again.
* **Session start core rules:** the plugin injects the core rules into every Claude Code session through a SessionStart hook. Antigravity has no hooks, so the same rules are written into `GEMINI.md` and `.agent/rules/core-rules.md`, which it always loads.
* **Bin entrypoints:** the plugin puts short commands on the shell PATH. Antigravity has no such PATH entry, so the text in `.agent/` calls the scripts directly (for example `node .agent/skills/worktree/scripts/worktree.cjs`). Two commands have no script here and are replaced by a note or dropped: the one that marks the active plan (it only feeds Claude Code hooks, so keep the plan path in your notes) and the one that shows where an API key was found (look at `.agent/skills/.env.example` for the lookup order).
* **Runtime copies:** the plugin copies its scripts and a Python venv into a per-user runtime directory. Here, scripts run from `.agent/` and `bash .agent/skills/install.sh` builds the venv in `.agent/skills/.venv`.

## Context that hooks used to inject

Claude Code hooks inject `## Plan Context`, `## Naming`, the plan directory and the reports path. Antigravity has no hooks, so use these defaults:

* New plan directory: `plans/{YYMMDD-HHmm}-{slug}/`
* Reports: `{plan-dir}/reports/` when a plan is active, otherwise `plans/reports/`
* Report file name: `{type}-{YYMMDD-HHmm}-{slug}.md`, where `type` is the role (researcher, reviewer, debugger, tester, ...)
* Skip steps that set an active plan or run hook scripts.

## Guards that hooks used to enforce

* **Privacy:** do not read `.env` files (except `.env.example`), private keys, credential files or token stores. If a task needs one, ask the user first and say why.
* **Scope:** do not list or search inside `node_modules`, `.venv`, `dist`, `build`, `.git`, `vendor` or `__pycache__` unless the user asks.

## Claude Code-only features

* `claude -p`, Claude model names (opus, sonnet, haiku) and Claude Code settings do not apply. When a skill step needs `claude -p` (for example the description optimizer in `create-skill`), skip that step and tell the user.
* `rig:remote` and `rig:team` are not included in `.agent/`, and neither is the plugin setup skill.
* Frontmatter keys that only Claude Code understands (model, effort, hooks, allowed tools, forked context, ...) are removed from the skills and agents here.
* Paths under `~/.claude/` point to Claude Code user files. Skills and scripts here live in `.agent/skills/` and `.agent/scripts/`.
* API keys for skill scripts (for example `GEMINI_API_KEY` for `media`) are read from environment variables first.
