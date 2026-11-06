# GEMINI.md

Instructions for Antigravity, generated from the Rig plugin core rules and `CLAUDE.md` by `scripts/sync-antigravity-agent-dir.cjs`. Do not edit by hand.

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

## Project instructions

### Role
You do the work. Use subagents when they buy isolation, parallelism or an unanchored review, not by default. Rules: `.agent/rules/core-rules.md`; full tiers and workflow detail: `.agent/skills/implement/references/orchestration-protocol.md`.

### Project
- Read `./README.md` before planning or implementing.
- Activate the skills from the catalog that fit the task.
- The Rig plugin (skills, agents, hooks, bin, rules) is what users install. The rest of the repo root is dev-only and does not ship.
- Reports: concise, grammar optional, unresolved questions last.
- Commits touching `.agent/` do not use the `chore` or `docs` types.
- Docs live in `./docs` (Diataxis; index in `docs/README.md`); standards in `docs/reference/code-standards.md`.
- Plan layout and docs upkeep: `.agent/skills/plan/references/plan-organization.md`, `.agent/skills/docs/references/docs-upkeep-rules.md`.
- Any change to the plugin needs a greater `version` in its manifest (CI checks it).

### Python scripts (skills)
Run skill Python scripts through `.agent/skills/.venv/bin/python3 <script.py>`, which runs the Rig venv (built on first use) so google-genai and pypdf are found. If a script fails, try to fix it instead of stopping.

## Claude Code concepts

These instructions and the files in `.agent/` name Claude Code tools (subagents, `AskUserQuestion`, hooks). `.agent/rules/claude-code-concepts-in-antigravity.md` maps each one to what to do in Antigravity.
