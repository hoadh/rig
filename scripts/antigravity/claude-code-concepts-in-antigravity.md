# Claude Code Concepts in Antigravity

The rules, skills and agents of this plugin are generated from Rig's Claude Code plugin. They still name Claude Code tools and features. Read them through this mapping.

## Tools

| Text says | Do this in Antigravity |
|---|---|
| Delegate to the `<name>` agent, spawn a subagent, `Agent(...)` | Call `invoke_subagent` with `TypeName` set to the agent name (`planner`, `implementer`, `tester`, ...), a short `Role` and a self-contained `Prompt`. Give it the work-context paths (workspace root, plan and reports directories); a subagent starts with a fresh context. |
| `AskUserQuestion` | Ask the user in chat. List the options, mark the recommended one, and wait for the answer. |
| `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite` | Track steps in your own task list. Plan files in `plans/` stay the source of truth. |
| `Skill` tool, "activate the `<name>` skill", `/<name>` | Read `<Rig root>/skills/<name>/SKILL.md` and follow it. |
| `$ARGUMENTS` | The text the user typed after the skill command. |
| `SendMessage` | Subagents answer their caller with `send_message`; there are no peer teammates. |
| `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` | `read_file`, `write_file`, `edit_file`, `run_command`, and file search through the shell. |

## What the hooks do for you

* **Session start:** prints `Rig root: <path>` and the Rig session context. Use that path for every `<Rig root>` in this plugin.
* **Per-prompt reminders:** the plan, naming and reports context is injected before model calls.
* **Guards:** a bash safety guard and a verify-before-done guard run as hooks. A denied command comes back with a reason; do not look for a way around it.
* **Active plan:** skill steps that mark the active plan run `node <Rig root>/scripts/set-active-plan-antigravity.cjs`, which keys on `ANTIGRAVITY_CONVERSATION_ID`.

If a hook context is missing, use these defaults:

* New plan directory: `plans/{YYMMDD-HHmm}-{slug}/`
* Reports: `{plan-dir}/reports/` when a plan is active, otherwise `plans/reports/`
* Report file name: `{type}-{YYMMDD-HHmm}-{slug}.md`, where `type` is the role (researcher, reviewer, debugger, tester, ...)

## Not available here

* The Claude Code statusline, plugin setup and migration commands, `rig:remote`, `rig:team` and Agent Teams are not part of this plugin.
* `claude -p`, Claude model names (opus, sonnet, haiku) and Claude Code settings do not apply. When a skill step needs `claude -p` (for example the description optimizer in `create-skill`), skip that step and tell the user.
* Paths under `~/.claude/` point to Claude Code user files. API keys for skill scripts (for example `GEMINI_API_KEY` for `media`) are read from environment variables first.
* There is no Rig Python venv: skills that run Python use `python3` and need their packages installed (`google-genai`, `pypdf`, see the skill's `requirements.txt`).
