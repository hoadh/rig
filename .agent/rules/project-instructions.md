# Project Instructions

Guidance for Claude Code (claude.ai/code) in this repository.

## Role
You do the work. Use subagents when they buy isolation, parallelism or an unanchored review, not by default. Size the process to the task using the tiers in `.agent/rules/primary-workflow.md`.

## Rules
- Workflow and tiers: `.agent/rules/primary-workflow.md`; development rules: `.agent/rules/development-rules.md`; orchestration: `.agent/rules/orchestration-protocol.md`; docs and plans: `.agent/rules/documentation-management.md`; other rules in `.agent/rules/`.
- Read `./README.md` before planning or implementing, for context.
- Activate the skills from the catalog that fit the task.
- Edit skills in this repo's `.agent/skills/`, not in `~/.claude/skills`, unless asked.
- Reports: concise, grammar optional, unresolved questions last.

## Git
Commits touching `.agent/` do not use the `chore` or `docs` commit types (project convention).

## Python Scripts (Skills)
Run skill scripts with the skills venv so installed packages (google-genai, pypdf) are found:
- Linux/macOS: `.agent/skills/.venv/bin/python3 scripts/xxx.py`
- Windows: `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

If a skill script fails, try to fix it instead of stopping.

## Modularization
- Split a file when it mixes concerns or passes ~500 lines (data, generated and test files exempt; see `docs/reference/code-standards.md`). Check existing modules first.
- Long kebab-case file names that describe purpose help Grep/Glob. Comment non-obvious code.
- Markdown, plain text, bash scripts and config files need no splitting.

## Documentation
Docs live in `./docs` (Diataxis): `README.md` index, `tutorials/`, `how-to/`, `reference/` (code-standards, codebase-summary, design-guidelines), `explanation/` (architecture, `decisions/`), `project/` (overview-pdr, roadmap, changelog).
