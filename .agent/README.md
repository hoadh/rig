# Antigravity `.agent/` Directory

This directory is Rig's kit for [Google Antigravity](https://antigravity.google/). It is generated from Rig's Claude Code plugin in `plugins/rig/`:

```bash
node scripts/sync-antigravity-agent-dir.cjs
```

Do not edit files here by hand, except this README. Change `plugins/rig/` (or `CLAUDE.md`) and run the sync again. The release script runs it too, and CI (`.github/workflows/antigravity-sync-check.yml`) fails when the committed files differ from a fresh sync.

## Layout

| Path | Source | Purpose |
|---|---|---|
| `rules/` | `plugins/rig/rules/core-rules.md` | The core rules, plus `claude-code-concepts-in-antigravity.md`, which maps Claude Code tools (subagents, `AskUserQuestion`, hooks) and plugin features to what Antigravity does instead |
| `scripts/` | `plugins/rig/scripts/` | The docs validator and migrator the `docs` skill calls (`node .agent/scripts/validate-docs.cjs docs/`) |
| `workflows/<name>.md` | user-invocable skills | `/<name>` loads `.agent/skills/<name>/SKILL.md`. Names drop the `rig:` prefix: `/plan`, `/implement`, `/fix`, `/debug`, ... |
| `skills/` | `plugins/rig/skills/` | Skill files, with plugin commands and paths rewritten to `.agent/` paths and Claude Code-only frontmatter keys removed |
| `agents/` | `plugins/rig/agents/` | Role files. Antigravity has no subagents, so a rule that says "delegate to `planner`" means: read `agents/planner.md` and do that role yourself |
| `../GEMINI.md` | core rules + `CLAUDE.md` | Core rules, project instructions and a pointer to the concept mapping, at the repo root |

Not included: `rig:remote` and `rig:team` (they need Claude Code's headless runs and Agent Teams), the plugin itself (manifest, hooks, bin commands, runtime copies, setup), settings and output styles.

## Setup

Install the Python and Node dependencies some skills use:

```bash
bash .agent/skills/install.sh
```

Skill scripts read API keys (for example `GEMINI_API_KEY`) from environment variables first. Never commit `.env` files.
