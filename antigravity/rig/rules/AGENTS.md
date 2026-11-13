# Rig for Antigravity

Generated from the Rig plugin core rules by `scripts/sync-antigravity-plugin.cjs`. Do not edit by hand.

## Core rules

- Principles: YAGNI, KISS, DRY. Do the simplest thing that works.
- Size the process. Trivial (1 file, obvious): edit, run tests, no plan or subagents. Standard (few files): short plan, implement yourself, tests, one review if logic changed, docs if behavior or API changed. Large (multi-phase, cross-cutting): `/plan`, `/implement`, tester and reviewer, docs. Risk signals (auth, data, infra, public API) force Large. User override wins. Full tiers: `references/orchestration-protocol.md` of the `implement` skill.
- Names: kebab-case, descriptive (JS/TS/Python/shell); follow the language convention elsewhere.
- File size: split when a file mixes concerns or passes ~500 lines (data, generated, tests exempt).
- Edit existing files; no "enhanced" copies. Real behavior, no mocks standing in for it.
- Commits: conventional, focused, no AI references; lint before commit, tests before push.
- Never commit secrets (dotenv, keys, credentials); a pushed secret is leaked.
- Everything in the repo is English (code, docs, plans, commits, branches). Chat follows the user's language.
- Verify before claiming done: compile, run the relevant tests, report evidence. Never skip or weaken a failing test.
- Privileged steps (sudo, docker, services): prep first, give ONE block with all commands, wait for "done", verify yourself.
- Remote hosts: resolve user/host with `ssh -G <host>`, never guess. Production is read-only without explicit approval.
- Subagent prompts include the work-context root, reports and plans paths when they differ from CWD.
- Subagents end with:
  `**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` / `**Summary:**` / `**Concerns/Blockers:**`

## Rig root

The session start context prints `Rig root: <absolute path>`: the directory of this plugin. Wherever a skill, agent or rule
names `<Rig root>/...`, replace `<Rig root>` with that path before you run the command or read the file.
Paths are always absolute; never resolve them against the workspace.

## Claude Code Concepts in Antigravity

The rules, skills and agents of this plugin are generated from Rig's Claude Code plugin. They still name Claude Code tools and features. Read them through this mapping.

### Tools

| Text says | Do this in Antigravity |
|---|---|
| Delegate to the `<name>` agent, spawn a subagent, `Agent(...)` | Call `invoke_subagent` with `TypeName` set to the agent name (`planner`, `implementer`, `tester`, ...), a short `Role` and a self-contained `Prompt`. Give it the work-context paths (workspace root, plan and reports directories); a subagent starts with a fresh context. |
| `AskUserQuestion` | Ask the user in chat. List the options, mark the recommended one, and wait for the answer. |
| `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite` | Track steps in your own task list. Plan files in `plans/` stay the source of truth. |
| `Skill` tool, "activate the `<name>` skill", `/<name>` | Read `<Rig root>/skills/<name>/SKILL.md` and follow it. |
| `$ARGUMENTS` | The text the user typed after the skill command. |
| `SendMessage` | Subagents answer their caller with `send_message`; there are no peer teammates. |
| `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` | `read_file`, `write_file`, `edit_file`, `run_command`, and file search through the shell. |

### What the hooks do for you

* **Session start:** prints `Rig root: <path>` and the Rig session context. Use that path for every `<Rig root>` in this plugin.
* **Per-prompt reminders:** the plan, naming and reports context is injected before model calls.
* **Guards:** a bash safety guard and a verify-before-done guard run as hooks. A denied command comes back with a reason; do not look for a way around it.
* **Active plan:** skill steps that mark the active plan run `node <Rig root>/scripts/set-active-plan-antigravity.cjs`, which keys on `ANTIGRAVITY_CONVERSATION_ID`.

If a hook context is missing, use these defaults:

* New plan directory: `plans/{YYMMDD-HHmm}-{slug}/`
* Reports: `{plan-dir}/reports/` when a plan is active, otherwise `plans/reports/`
* Report file name: `{type}-{YYMMDD-HHmm}-{slug}.md`, where `type` is the role (researcher, reviewer, debugger, tester, ...)

### Not available here

* The Claude Code statusline, plugin setup and migration commands, `rig:remote`, `rig:team` and Agent Teams are not part of this plugin.
* `claude -p`, Claude model names (opus, sonnet, haiku) and Claude Code settings do not apply. When a skill step needs `claude -p` (for example the description optimizer in `create-skill`), skip that step and tell the user.
* Paths under `~/.claude/` point to Claude Code user files. API keys for skill scripts (for example `GEMINI_API_KEY` for `media`) are read from environment variables first.
* There is no Rig Python venv: skills that run Python use `python3` and need their packages installed (`google-genai`, `pypdf`, see the skill's `requirements.txt`).
