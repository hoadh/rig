# AGENTS.md

This file provides guidance to coding agents that read `AGENTS.md` when working with code in this repository. Claude Code reads `CLAUDE.md`; Antigravity gets Rig as a plugin generated into `antigravity/rig/` (see `docs/reference/antigravity-feature-map.md`).

## Project Overview

**Name:** rig
**Type:** Node.js
**Description:** Rig, an Agentic-Driven Development toolkit for Claude Code: agents, skills, hooks, rules and workflows that plan, build, test and review software with file-based state.

## Role

You do the work. Use subagents when they buy isolation, parallelism or an unanchored review, not by default. Size the process to the task using the tiers in `./plugins/rig/skills/implement/references/orchestration-protocol.md`.

## Workflows

- Core rules: `./plugins/rig/rules/core-rules.md`
- Size tiers, workflow detail, subagent protocol: `./plugins/rig/skills/implement/references/orchestration-protocol.md`
- Plans: `./plugins/rig/skills/plan/references/plan-organization.md`; docs upkeep: `./plugins/rig/skills/docs/references/docs-upkeep-rules.md`
- The Rig plugin (what users install) is `./plugins/rig/`; the rest of the repo root is dev-only

Activate the skills from the catalog that fit the task. Read `./README.md` before planning or implementing. Reports: concise, unresolved questions last.

## Development Principles

- **YAGNI**: You Aren't Gonna Need It - avoid over-engineering
- **KISS**: Keep It Simple, Stupid - prefer simple solutions
- **DRY**: Don't Repeat Yourself - eliminate code duplication

## Documentation

Keep all important docs in `./docs` folder:

```
./docs
├── README.md          # Diataxis index
├── tutorials/         # learning paths (only if needed)
├── how-to/            # task guides (deploy.md)
├── reference/         # code-standards.md, codebase-summary.md, design-guidelines.md
├── explanation/       # architecture.md, decisions/ (ADRs)
└── project/           # overview-pdr.md, roadmap.md, changelog.md
```
