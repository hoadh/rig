# Antigravity `.agent/` Directory

This directory is Rig's kit for [Google Antigravity](https://antigravity.google/). It is generated from the Claude Code kit in `.claude/`:

```bash
node scripts/sync-antigravity-agent-dir.cjs
```

Do not edit files here by hand, except this README. Change `.claude/` (or `CLAUDE.md`) and run the sync again. The release script runs it too, and CI (`.github/workflows/antigravity-sync-check.yml`) fails when the committed files differ from a fresh sync.

## Layout

| Path | Source | Purpose |
|---|---|---|
| `rules/` | `.claude/rules/*.md`, `CLAUDE.md` | Always-on rules, plus `claude-code-concepts-in-antigravity.md`, which maps Claude Code tools (subagents, `AskUserQuestion`, hooks) to what Antigravity does instead |
| `workflows/<name>.md` | user-invocable skills | `/<name>` loads `.agent/skills/<name>/SKILL.md`. Names drop the `rig:` prefix: `/plan`, `/implement`, `/fix`, `/debug`, ... |
| `skills/` | `.claude/skills/` | Skill files, with `.claude/` paths rewritten to `.agent/` |
| `agents/` | `.claude/agents/` | Role files. Antigravity has no subagents, so a rule that says "delegate to `planner`" means: read `agents/planner.md` and do that role yourself |
| `../GEMINI.md` | `CLAUDE.md` | Project instructions at the repo root |

Not included: `rig:remote` and `rig:team` (they need Claude Code's headless runs and Agent Teams), hooks, settings and output styles.

## Setup

Install the Python and Node dependencies some skills use:

```bash
bash .agent/skills/install.sh
```

Skill scripts read API keys (for example `GEMINI_API_KEY`) from environment variables first. Never commit `.env` files.
