# Codebase Summary

**Last Updated**: 2026-11-06
**Version**: 1.1.0 (release pending)
**Repository**: [hoadh/rig](https://github.com/hoadh/rig)

## Overview

Rig is an Agentic-Driven Development (ADD) toolkit for building software with Claude Code (Antigravity through the generated `.agent/` copy). It provides a complete development environment with AI-powered agent orchestration, automated workflows, and intelligent project management.

## Project Structure

```
rig/
├── .claude/               # Claude Code configuration
│   ├── agents/           # Specialized agent definitions (14 agents)
│   ├── hooks/            # Context hooks, hook tests
│   ├── rules/            # core-rules.md only; task rules live in skill references
│   ├── schemas/          # .rig.json schema
│   ├── scripts/          # Helper scripts
│   ├── skills/           # Specialized skills library (31 skills)
│   ├── metadata.json     # Kit version and build date
│   ├── settings.json     # Hooks, permissions, statusline
│   └── statusline.cjs    # Statusline script
├── .agent/              # Antigravity copy (generated, see GEMINI.md)
├── .github/             # GitHub Actions workflows
│   └── workflows/       # ci.yml (lint, tests, eval tier 1, pytest); antigravity-sync-check.yml
├── docs/                # Project documentation (Diataxis layout, index: docs/README.md)
│   ├── tutorials/ how-to/ reference/ explanation/   # One Diataxis type per dir
│   ├── project/         # PDR, roadmap, changelog
│   └── research/ devlog/ assets/   # Not reader docs, left untouched
├── guide/               # User guides and references
├── scripts/             # Installer, release, Antigravity sync, eval (scripts/eval/), benchmark (scripts/benchmark/)
├── plans/               # Implementation plans and reports
│   └── reports/         # Agent-to-agent communication
├── CLAUDE.md           # Project-specific Claude instructions
├── README.md           # Project overview
└── package.json        # Node.js dependencies
```

## Core Technologies

### Runtime & Dependencies
- **Node.js**: >=18.0.0
- **Package Manager**: npm
- **License**: MIT (see `LICENSE`)

### Development Tools
- **ESLint 10**: `npm run lint`, flat config in `eslint.config.mjs`
- **Repomix**: Codebase compaction for AI consumption

### CI/CD
- **GitHub Actions**: `ci.yml` (lint, Node tests on three OSes, eval tier 1, pytest) and `antigravity-sync-check.yml`; releases are manual
- **Semantic Versioning**: bumped by hand in `package.json` and `.claude/metadata.json`
- **Conventional Commits**: Structured commit messages

## Key Components

### 1. Agent Orchestration System (14 Agents)

**Claude Code Agents** (`.claude/agents/`):
- `planner.md` - Technical planning and architecture (Opus model)
- `researcher.md` - Research and analysis
- `implementer.md` - Implements plan phases (backend, frontend, infra)
- `code-reviewer.md` - Code quality assessment
- `tester.md` - Testing and validation
- `debugger.md` - Issue analysis and debugging
- `docs-maintainer.md` - Documentation management
- `git-operator.md` - Version control operations
- `devlog-writer.md` - Devlog entries: shipped work, decisions, lessons
- `brainstormer.md` - Solution ideation
- `progress-tracker.md` - Progress tracking against plans
- `ui-ux-designer.md` - UI/UX design
- `mcp-runner.md` - Runs MCP tools outside the main context (Gemini CLI first)
- `code-simplifier.md` - Code optimization and simplification

### 2. Slash Commands System (Skill-Backed)

**Core Development Commands**:
- `/rig:plan` - Research and planning
- `/rig:implement` - Feature implementation
- `/rig:test` - Test execution
- `/rig:brainstorm` - Solution ideation
- `/rig:debug` - Issue debugging
- `/rig:fix` - Bug fixes

**Skill Directories** (`.claude/skills/`):
- `docs/` - Documentation workflows
- `rig-plan/` - Planning workflow
- `code-review/` - Code review workflows
- `test/` - Testing workflows

### 3. Skills Library (31 Skills)

**Organized Groups** (Progressive Disclosure):
- **UI Styling** (`ui-styling/`) - shadcn/ui, Tailwind CSS v4
  - 7 references, 2 Python utilities

**Current Skills** (31 Total, plus the `common/` shared library):
- media, brainstorm, browser, code-review, context-engineering
- implement, diataxis-writer, docs, library-docs, fix, git, devlog
- markdown-viewer, mcp, mermaidjs-v11, problem-solving, visualize
- progress, project-organization, research, rig-debug, rig-plan
- explore, pr, create-skill, team, test
- ui-styling, ui-design, worktree
- remote (multi-machine plans over ssh; `scripts/remote.cjs` orchestrator, `scripts/worker.cjs` worker; see [how-to](../how-to/run-plan-across-machines.md))

### 4. Hook System (6 Core Hooks)

**Location**: `.claude/hooks/`

Rig uses six hooks. Permission checks, naming rules and usage display use native features (see [system components](./system-components.md)).

| Hook | Event | Purpose |
|------|-------|---------|
| `session-init.cjs` | SessionStart | Exports Rig session vars and paths (`RIG_SESSION_ID`, `RIG_ACTIVE_PLAN`, `RIG_REPORTS_PATH`, `RIG_PROJECT_ROOT`, `RIG_GIT_BRANCH`, ...) |
| `subagent-init.cjs` | SubagentStart | Injects dynamic Rig context (paths, plan context, naming) into subagents |
| `team-context-inject.cjs` | SubagentStart | Injects agent team context (peers, tasks) |
| `dev-rules-reminder.cjs` | UserPromptSubmit | Injects a short `## Rig Session` block: date, paths, plan context, naming |
| `verify-completion-guard.cjs` | Stop | Nudges or blocks a stop when code was edited and no passing verify command ran (`verifyGuard.mode`) |
| `bash-safety-guard.cjs` | PreToolUse (Bash) | Denies or asks on `sed -i` of a symlink and risky `pkill`; toggles in global config only |

Supporting modules in `.claude/hooks/lib/`: `bash-command-segment-tokenizer.cjs`, `bash-safety-rule-engine.cjs`, `bash-in-place-edit-symlink-rule.cjs`, `bash-process-kill-rule.cjs`, `bash-safety-guard-config.cjs`, `verify-guard-config.cjs`, `verify-command-detector.cjs`, `turn-edit-and-verify-scanner.cjs`, `verify-guard-turn-counter.cjs`, `unsafe-regex-shape-checker.cjs` (ReDoS pre-filter), `regex-test-with-timeout.cjs` (vm-bounded regex runs). Guide: [how-to](../how-to/configure-verification-and-safety-guards.md).

**Hook Features:**
- Fail-Safe: hooks exit 0 (non-blocking) - graceful degradation
- Small output: only dynamic facts are injected; static rules stay in `.claude/rules/`
- Cross-Platform: Node.js `.cjs` scripts run on Windows and Unix
- Tests: `npm test` runs every hook test file via `scripts/run-hook-tests.cjs`

**Native replacements:**
- Sensitive files and heavy directories: `permissions.ask` / `permissions.deny` in `.claude/settings.json`
- File naming: `.claude/rules/core-rules.md`
- Context usage: statusline reads `rate_limits` from stdin

### 5. Workflows

**Rules and workflow detail** (layout and where each moved section lives: [rules layout](../explanation/rules-layout.md)):
1. **`.claude/rules/core-rules.md`** (<=1.5 KB, loaded natively and injected into subagents): principles, naming, secrets, verification, language, size tiers (one line)
2. **`.claude/skills/implement/references/orchestration-protocol.md`**: full size tiers, workflow detail, subagent status protocol
3. **`.claude/skills/rig-plan/references/plan-organization.md`**: plan layout, phase file sections, Pending Live Verification
4. **`.claude/skills/docs/references/docs-upkeep-rules.md`**: roadmap and changelog upkeep
5. **`.claude/skills/team/references/team-coordination.md`**: Agent Teams behavior
6. **`.claude/skills/remote/SKILL.md`**: SSH host resolution and production read-only rules

## Entry Points

### For Users
- **README.md**: Project overview and quick start
- **guide/SKILLS.md**: Comprehensive skills reference
- **CLAUDE.md**: Development instructions and workflows

### For Developers
- **package.json**: Dependencies and scripts
- **.gitignore**: Version control exclusions

### For Agents
- **CLAUDE.md**: Primary agent instructions
- **.claude/rules/core-rules.md**: Core rules (task-specific rules live in skill references)

## Development Principles

### YAGNI (You Aren't Gonna Need It)
Avoid over-engineering and unnecessary features

### KISS (Keep It Simple, Stupid)
Prefer simple, straightforward solutions

### DRY (Don't Repeat Yourself)
Eliminate code duplication

### File Size Management
- Keep files under 500 lines
- Split large files into focused components
- Extract utilities into separate modules

### Security First
- Try-catch error handling
- Security standards coverage
- No secrets in commits
- Confidential info protection

## Agent Communication Protocol

**Report Format**: Markdown files in `./plans/<plan-name>/reports/`
**Naming Convention**: `{date}-from-[agent]-to-[agent]-[task]-report.md`

**Communication Patterns**:
- Sequential: Task dependencies require ordered execution
- Parallel: Independent tasks run simultaneously
- Query Fan-Out: Multiple researchers explore different approaches

## Git Workflow

**Commit Message Format**: Conventional Commits
```
type(scope): description

Types:
- feat, fix, docs, refactor, test, ci
- `BREAKING CHANGE:` footer for breaking changes (version bumps are manual)
```

**Release** (manual):
- `scripts/prepare-release-assets.cjs` builds `rig.zip`; `scripts/generate-release-manifest.cjs` writes the manifest
- Publish a GitHub Release from the tag; `CHANGELOG.md` is written by hand

## Testing Strategy

- Comprehensive unit tests required
- High code coverage mandatory
- Error scenario testing
- Performance validation
- Tests must pass before push
- No ignoring failed tests

## Documentation Standards

**Required Docs** (`./docs/`, Diataxis layout, see `.claude/skills/docs/references/diataxis-docs-layout.md`):
- `README.md` - Docs index grouped by type
- `project/overview-pdr.md` - Project overview and PDR
- `reference/code-standards.md` - Coding standards and structure
- `reference/codebase-summary.md` - This file
- `explanation/architecture.md` - Architecture documentation
- `project/roadmap.md` - Development roadmap
- `project/changelog.md` - Detailed changelog

**Documentation Triggers**:
- Feature implementation completion
- Major milestone achievements
- Bug fixes
- Security updates
- Weekly reviews

## Dependencies Overview

### Production Dependencies
None (template project)

### Development Dependencies
- `eslint`, `@eslint/js`, `globals`, `typescript-eslint` (lint only)
- Tests run with plain Node (`npm test`)

## Integration Capabilities

### GitHub Actions
Workflow: `.github/workflows/antigravity-sync-check.yml`
Features: Fails when `.agent/` or `GEMINI.md` drift from `.claude/`

### Agent Skills
- **problem-solving**: Structured reasoning
- **library-docs**: Library documentation lookup
- **media**: Image, video and document analysis and generation

## Critical Files

### Configuration
- `package.json` - Node.js config
- `.gitignore` - Git exclusions
- `.repomixignore` - Repomix exclusions

### Documentation
- `README.md` - Main project docs
- `CLAUDE.md` - Agent instructions
- `CHANGELOG.md` - Version history
- `guide/SKILLS.md` - Skills reference

### Workflows
- `.claude/rules/core-rules.md`
- `.claude/skills/implement/references/orchestration-protocol.md`

## Version History

**Current**: 1.1.0 (implemented, release pending); 1.0.0 released 2026-10-17. See `CHANGELOG.md`
**License**: MIT (see `LICENSE`)
**Author**: Alex Dang
**Repository**: https://github.com/hoadh/rig

## Open Items

See the [roadmap](../project/roadmap.md).
