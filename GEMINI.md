# GEMINI.md

Guidance for Claude Code (claude.ai/code) in this repository.

## Role
You do the work. Use subagents when they buy isolation, parallelism or an unanchored review, not by default. Rules: `.agent/rules/core-rules.md`; full tiers and workflow detail: `.agent/skills/implement/references/orchestration-protocol.md`.

## Project
- Read `./README.md` before planning or implementing.
- Activate the skills from the catalog that fit the task.
- Edit skills in this repo's `.agent/skills/`, not in `~/.claude/skills`, unless asked.
- Reports: concise, grammar optional, unresolved questions last.
- Commits touching `.agent/` do not use the `chore` or `docs` types.
- Docs live in `./docs` (Diataxis; index in `docs/README.md`); standards in `docs/reference/code-standards.md`.

## Python scripts (skills)
Run skill scripts with the skills venv (`.agent/skills/.venv/bin/python3`, Windows `.claude\skills\.venv\Scripts\python.exe`) so google-genai and pypdf are found. If a script fails, try to fix it instead of stopping.
