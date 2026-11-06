# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## Role
You do the work. Use subagents when they buy isolation, parallelism or an unanchored review, not by default. Rules: `plugins/rig/rules/core-rules.md`; full tiers and workflow detail: `plugins/rig/skills/implement/references/orchestration-protocol.md`.

## Project
- Read `./README.md` before planning or implementing.
- Activate the skills from the catalog that fit the task.
- The Rig plugin (skills, agents, hooks, bin, rules) is what users install. The rest of the repo root is dev-only and does not ship.
- Reports: concise, grammar optional, unresolved questions last.
- Commits touching `.claude/` do not use the `chore` or `docs` types.
- Docs live in `./docs` (Diataxis; index in `docs/README.md`); standards in `docs/reference/code-standards.md`.
- Plan layout and docs upkeep: `plugins/rig/skills/plan/references/plan-organization.md`, `plugins/rig/skills/docs/references/docs-upkeep-rules.md`.
- Any change to the plugin needs a greater `version` in its manifest (CI checks it).

## Python scripts (skills)
Run skill Python scripts through `rig-python <script.py>`, which runs the Rig venv (built on first use) so google-genai and pypdf are found. If a script fails, try to fix it instead of stopping.
