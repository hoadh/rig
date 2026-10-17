# AGENTS.md

This file provides guidance to coding agents that read `AGENTS.md` when working with code in this repository. Claude Code reads `CLAUDE.md`; Antigravity reads `GEMINI.md`.

## Project Overview

**Name:** rig
**Type:** Node.js
**Description:** Rig, an Agentic-Driven Development toolkit for Claude Code: agents, skills, hooks, rules and workflows that plan, build, test and review software with file-based state.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- And other workflows: `./.claude/rules/*`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** You must follow strictly the development rules in `./.claude/rules/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

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
