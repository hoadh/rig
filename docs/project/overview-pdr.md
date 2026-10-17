# Project Overview & Product Development Requirements (PDR)

**Project Name**: Rig
**Version**: 1.0.0
**Last Updated**: 2026-10-17
**Status**: Active Development
**Repository**: https://github.com/hoadh/rig

## Executive Summary

Rig is an Agentic-Driven Development (ADD) toolkit for Claude Code: plans come first, specialized agents execute and verify each phase, and humans steer scope and approvals. Rig ships the agents, skills, hooks, rules and workflows that make that loop repeatable across projects and machines. A generated copy in `.agent/` and `GEMINI.md` serves Antigravity.

## Project Purpose

### Vision
Let developers build software faster and with higher quality by delegating planning, implementation, testing, review and documentation to coordinated agents, while keeping humans in charge of direction.

### Mission
Provide a toolkit that:
- Turns every feature into a phased plan before code changes
- Gates each phase with tests and code review
- Keeps docs, plans and devlog in sync as part of the loop
- Keeps git history clean with conventional commits
- Runs the same workflow on one machine or across several

### Value Proposition
- **Plan-first delivery**: `/rig:plan` writes phased plans with research from parallel agents
- **Consistent quality**: tester and code-reviewer agents gate every phase
- **Living documentation**: docs-maintainer keeps `docs/` (Diataxis layout) current
- **Clean git history**: conventional commits, no AI attribution
- **Fresh context per agent**: agents hand off through files, not chat history

## Target Users

### Primary Users
1. **Solo developers**: build features faster with agents doing planning, tests and docs
2. **Small teams**: share one workflow, one set of rules and one docs layout
3. **Open source maintainers**: keep review quality and docs consistent

### User Personas

**Persona 1: Solo Full-Stack Developer**
- **Needs**: Fast iteration, quality code, little documentation overhead
- **Pain Points**: Context switching, documentation maintenance, testing gaps
- **Solution**: Agents handle planning, testing and docs while the developer steers features

**Persona 2: Technical Lead**
- **Needs**: Enforce standards, review code, maintain architecture docs
- **Pain Points**: Review bottleneck, inconsistent patterns, outdated docs
- **Solution**: Review gates, shared rules in `.claude/rules/`, living documentation

**Persona 3: Open Source Maintainer**
- **Needs**: Scale contributions, maintain quality, clear documentation
- **Pain Points**: Limited time, varying contribution quality, doc rot
- **Solution**: Consistent review process and docs workflow

## Key Features & Capabilities

### 1. Multi-Agent Orchestration

14 subagents in `.claude/agents/`:
- **Plan and research**: `planner`, `researcher`, `brainstormer`
- **Build**: `implementer`, `code-simplifier`, `ui-ux-designer`
- **Verify**: `tester`, `code-reviewer`, `debugger`
- **Docs and delivery**: `docs-maintainer`, `progress-tracker`, `devlog-writer`, `git-operator`, `mcp-runner`

**Orchestration Patterns**:
- **Sequential chaining**: Plan → Implement → Simplify → Test → Review → Docs
- **Parallel execution**: several researchers or developers on independent work, with file ownership boundaries
- **Agent teams**: `/rig:team` runs several Claude Code sessions coordinated by a lead

Agents hand off through files in `plans/` and `plans/reports/` ([ADR 0001](../explanation/decisions/0001-agent-state-lives-in-files.md)).

### 2. Skills and Slash Commands

32 skills in `.claude/skills/`: 27 appear as `/rig:*` slash commands, 5 are internal helpers loaded by other skills.

**Core Development Commands**:
- `/rig:plan` - Research and write a phased implementation plan
- `/rig:implement` - Implement a plan phase by phase
- `/rig:fix` - Diagnose and fix a bug
- `/rig:test` - Run and analyze tests
- `/rig:code-review` - Review changes
- `/rig:debug` - Deep issue analysis
- `/rig:pr` - Open a pull request
- `/rig:docs` - Init, update, summarize or restructure docs

**Skills by Domain**:

**AI & Vision**: media
**Code Quality & Debugging**: code-review, rig-debug, sequential-thinking
**Content & Documentation**: brainstorm, diataxis-writer, docs, library-docs, markdown-viewer
**Design & Frontend**: ui-styling, ui-design
**Git & Workflow**: git, worktree, pr, devlog
**MCP Tools**: mcp
**Project Planning**: rig-plan, progress, project-organization
**Skill Development**: create-skill
**Testing & QA**: test, browser
**Visualization**: mermaidjs-v11, visualize
**Workflow Tools**: implement, fix, research, explore, team, remote, context-engineering, problem-solving

Full catalog: [guide/SKILLS.md](../../guide/SKILLS.md).

### 3. Hooks and Native Guards

**Hooks** (`.claude/hooks/`) inject dynamic facts only:
- `session-init`: session vars, paths, active plan
- `subagent-init`: Rig context for subagents
- `team-context-inject`: team peers and tasks
- `dev-rules-reminder`: `## Rig Session` block (datetime, paths, plan context, naming)

**Native Claude Code features**:
- Sensitive files: `permissions.ask` rules for `.env*`, keys, `*.pem`, credentials
- Heavy directories: `permissions.deny` rules for `node_modules`, `.venv`, `__pycache__`, `.next`, `.nuxt`, `coverage`
- Usage display: statusline reads `rate_limits` from stdin
- Notifications: optional `Stop` hook posts to Telegram, Discord or Slack

### 4. Automated Release Management

**Features**:
- Semantic versioning (MAJOR.MINOR.PATCH), conventional commits
- Manual release: `node scripts/prepare-release-assets.cjs <version>` builds `dist/rig.zip`, then `gh release` publishes it
- GitHub Releases with the `rig.zip` package (no npm publishing)
- Run `npm test` (every hook test file) before a release

### 5. Development Workflow Automation

**CI/CD** (GitHub Actions):
- `antigravity-sync-check.yml`: fails when `.agent/` or `GEMINI.md` differ from a fresh sync

### 6. Multi-Machine Orchestration (`rig:remote`)

Run plan phases and test commands on other machines (macOS, Windows, Linux) over ssh. Details: [how-to](../how-to/run-plan-across-machines.md), [ADR 0002](../explanation/decisions/0002-multi-machine-remote-orchestration.md).

- One orchestrator machine owns the plan. Workers run one headless agent per phase in a Rig-dedicated clone.
- Git is the only data channel. ssh is control only.
- Orchestrator reviews worker commits before `collect` merges them into `rig-int/<slug>`.
- Worker output is untrusted data. The worker threat model is in the how-to.

### 7. Antigravity Support

`node scripts/sync-antigravity-agent-dir.cjs` generates `.agent/` and `GEMINI.md` from `.claude/` and `CLAUDE.md`. Workflows drop the `rig:` prefix. `rig:remote` and `rig:team` are Claude Code only. Details: [Antigravity vs Claude Code](../explanation/antigravity-vs-claude-code.md).

## Technical Requirements

### Functional Requirements

**FR1: Agent Orchestration**
- Support sequential and parallel agent execution
- Hand off between agents through files in `plans/` and `plans/reports/`
- Give each agent only the context it needs
- Track task completion with Claude Code tasks

**FR2: Skills**
- Expose skills as `/rig:*` slash commands with arguments
- Route each skill to the right agents and workflow
- Hide helper skills from the `/` menu (`user-invocable: false`)

**FR3: Documentation Management**
- Keep docs in the Diataxis layout and validate it
- Migrate non-standard docs layouts (`/rig:docs restructure`)
- Keep the roadmap and changelog current
- Generate codebase summaries (repomix)

**FR4: Quality Assurance**
- Run tests after each implementation phase
- Review code before a phase is done
- Check compilation and type safety
- Validate security best practices

**FR5: Git Workflow**
- Enforce conventional commits
- Scan for secrets before commits
- Generate professional commit messages
- Create clean PR descriptions

**FR6: Installation**
- Install into a project `.claude/` or globally into `~/.claude/`
- Merge `settings.json` hooks and permissions without dropping user entries
- Run one copy of each hook when installed globally and in a project

**FR7: Multi-Machine Execution (`rig:remote`)**
- Dispatch a plan phase to a named worker machine
- Refuse dispatch when orchestrator work is unpushed or a `dependsOn` phase is not collected
- Track worker runs, review worker commits, and collect with per-machine tests

### Non-Functional Requirements

**NFR1: Performance**
- Small hook output: only dynamic facts are injected
- Parallel agents for independent tasks
- Heavy directories kept out of context (`permissions.deny`)

**NFR2: Reliability**
- Hooks fail safe (exit 0, non-blocking)
- Failing tests are fixed, never skipped
- Validate agent outputs before the next phase

**NFR3: Usability**
- Plain-language command names
- Clear errors and progress reports
- Docs organized by Diataxis

**NFR4: Maintainability**
- Code files under 500 lines
- Kebab-case, self-describing file names
- Agent and skill definitions in Markdown with frontmatter

**NFR5: Security**
- Ask before reading secrets (`permissions.ask`)
- Secret scan before commits
- No AI attribution in commits
- Worker output treated as untrusted (`rig:remote`)

**NFR6: Portability**
- Node.js `.cjs` hooks and scripts run on macOS, Linux and Windows

## Success Metrics

### Adoption Metrics
- Active installs (project and global)
- GitHub issues and pull requests

### Performance Metrics
- Planning to implementation cycle time: 50% reduction
- Code review time: 75% reduction

### Quality Metrics
- Conventional commit compliance: 100%
- Zero secrets in commits
- Hook test pass rate: 100% before release
- Docs updated in the same change as the code

### Developer Experience Metrics
- Time from install to first plan: < 5 minutes
- Satisfaction score: > 4.5/5.0

## Technical Architecture

### Core Components

**1. Agent Framework**
- Agent definition files (Markdown with frontmatter)
- File-based handoffs (`plans/`, `plans/reports/`)
- Rules in `.claude/rules/`

**2. Skills**
- `SKILL.md` plus `references/` and `scripts/` per skill
- Arguments passed through `$ARGUMENTS`

**3. Hooks**
- Four context hooks, Node.js `.cjs`
- Config in `.rig.json` (schema in `.claude/schemas/`)

**4. Documentation System**
- Diataxis layout, migrator and validator (`/rig:docs`)
- Repomix for codebase summaries

**5. Quality System**
- Test runner integration (`tester` agent, `/rig:test`)
- Code review (`code-reviewer` agent, `/rig:code-review`)

**6. Release System**
- `scripts/prepare-release-assets.cjs`, GitHub Releases with `rig.zip`

Architecture details: [system architecture](../explanation/architecture.md).

### Technology Stack

**Runtime**:
- Node.js >= 18.0.0
- Python 3 for some skill scripts

**AI Platforms**:
- Anthropic Claude (agents pick `opus`, `sonnet`, `haiku` or `inherit` in frontmatter)
- Google Gemini and MiniMax (`/rig:media`, optional)
- Gemini CLI (`/rig:mcp`, `mcp-runner`, `/rig:research`; optional)

**Development Tools**:
- Repomix (codebase compaction)

**CI/CD**:
- GitHub Actions
- Conventional Commits
- Automated versioning

### Integration Points

**MCP Tools**:
- Any server in `.claude/.mcp.json`, run through `/rig:mcp` and the `mcp-runner` agent (example: context7 for library docs)

**External Services**:
- GitHub (Actions, Releases, PRs via `gh`)
- ssh (`rig:remote` only)
- Telegram, Discord or Slack (notifications, optional)

## Use Cases

### UC1: Implement New Feature
**Actor**: Developer
**Goal**: Add a feature with the full workflow
**Flow**:
1. Run `/rig:plan "add user authentication"`
2. Researcher agents explore solutions, planner writes the phased plan
3. Developer reviews and approves the plan
4. Run `/rig:implement <plan path>`
5. Agents implement each phase
6. Tester runs tests, code-reviewer reviews
7. docs-maintainer updates documentation
8. git-operator commits with a conventional message

**Outcome**: Feature complete with tests, docs and clean git history

### UC2: Debug Production Issue
**Actor**: Developer
**Goal**: Identify and fix a production bug
**Flow**:
1. Run `/rig:debug "API timeout errors"` or `/rig:fix "API timeout errors"`
2. Debugger agent analyzes logs and system
3. Root cause identified
4. Fix implemented
5. Tests validate the fix
6. Code review confirms quality
7. Commit and deploy

**Outcome**: Bug fixed with tests and documentation

### UC3: Ship a Change
**Actor**: Developer
**Goal**: Get a reviewed change merged
**Flow**:
1. Developer completes the implementation
2. Run tests via `/rig:test`
3. Review via `/rig:code-review`
4. Commit via `/rig:git` or the git-operator agent
5. Open the PR via `/rig:pr`

**Outcome**: Clean commit history and a PR ready for review

### UC4: Update Documentation
**Actor**: Developer
**Goal**: Keep docs current
**Flow**:
1. Run `/rig:docs update`
2. docs-maintainer scans the codebase
3. Generates a fresh summary with repomix
4. Identifies outdated sections
5. Updates guides, reference and architecture
6. Validates the Diataxis layout
7. Writes an update report

**Outcome**: Documentation in sync with code

### UC5: Run a Plan Across Machines
**Actor**: Developer
**Goal**: Build and test on macOS, Windows and Linux
**Flow**:
1. Register workers in `~/.claude/rig-machines.json`
2. `/rig:plan` asks which machines to use and assigns phases
3. `rig:remote` dispatches phases to workers over ssh
4. Orchestrator reviews worker commits and runs `collect`

**Outcome**: Phases built and tested on each target OS, merged in phase order

## Constraints & Limitations

### Technical Constraints
- Requires Node.js >= 18.0.0
- Depends on Claude Code CLI (Antigravity through the generated `.agent/` copy, without `rig:remote` and `rig:team`)
- File-based communication has I/O overhead
- Token limits on model context windows
- `permissions.ask` covers the `Read`/`Edit` tools only; a Bash command such as `cat .env` is not caught

### Operational Constraints
- Requires a Claude Code subscription or API access
- GitHub Actions minutes for CI/CD
- Internet connection for MCP tools
- ssh access to workers for `rig:remote`

### Design Constraints
- Agent definitions are Markdown with frontmatter
- Commands follow slash syntax
- Reports use the naming pattern from the session hook
- Conventional commits required

## Risks & Mitigation

### Risk 1: AI Model API Failures
**Impact**: High
**Likelihood**: Medium
**Mitigation**: Retry, smaller tasks, escalate to the user after repeated failures

### Risk 2: Context Window Limits
**Impact**: Medium
**Likelihood**: High
**Mitigation**: Fresh context per agent, file-based handoffs, repomix summaries, selective loading

### Risk 3: Agent Coordination Failures
**Impact**: High
**Likelihood**: Low
**Mitigation**: File ownership per task, status protocol (DONE / BLOCKED / NEEDS_CONTEXT), review gates

### Risk 4: Secret Exposure
**Impact**: Critical
**Likelihood**: Low
**Mitigation**: `permissions.ask` rules, secret scan before commits, `.gitignore` enforcement

### Risk 5: Documentation Drift
**Impact**: Medium
**Likelihood**: Medium
**Mitigation**: Docs update in the same loop, Diataxis validator

## Roadmap

Status, next work and backlog: [roadmap](./roadmap.md). Release notes: [CHANGELOG](../../CHANGELOG.md).

## Dependencies & Integration

### Required Dependencies
- Node.js runtime
- Git
- Claude Code CLI

### Optional Dependencies
- Python 3 (skill scripts)
- Gemini or MiniMax API key (`/rig:media`)
- Gemini CLI (`/rig:mcp`, `mcp-runner`, `/rig:research`; falls back to scripts or WebSearch when missing)
- Telegram, Discord or Slack webhook (notifications)
- GitHub repository for CI/CD
- ssh-reachable workers (`rig:remote`)

### Integrations
- GitHub Actions
- Repomix
- MCP servers

## Compliance & Standards

### Coding Standards
- YAGNI (You Aren't Gonna Need It)
- KISS (Keep It Simple, Stupid)
- DRY (Don't Repeat Yourself)
- Files < 500 lines
- Comprehensive error handling
- Security-first development

### Git Standards
- Conventional Commits
- Clean commit history
- No AI attribution
- No secrets in commits
- Professional PR descriptions

### Documentation Standards
- Markdown, Diataxis layout
- Updated with the code change
- Clear examples

### Testing Standards
- Hook tests run before every release
- Integration tests for workflows
- Error scenario coverage
- Failing tests are fixed, never skipped

## Glossary

- **Agent**: Specialized AI assistant with specific expertise and responsibilities
- **Slash Command**: Shortcut that runs a skill (e.g., `/rig:plan`)
- **Skill**: Reusable knowledge module with instructions, references and scripts
- **MCP**: Model Context Protocol for AI tool integration
- **Repomix**: Tool for compacting codebases into an AI-friendly format
- **Sequential Chaining**: Running agents one after another with dependencies
- **Parallel Execution**: Running multiple agents simultaneously
- **Orchestrator / Worker**: In `rig:remote`, the machine that owns the plan and the machines that run phases
- **Conventional Commits**: Structured commit message format (type(scope): description)

## Appendix

### Related Documentation
- [Codebase Summary](../reference/codebase-summary.md)
- [Code Standards](../reference/code-standards.md)
- [System Architecture](../explanation/architecture.md)
- [Skills Reference](../../guide/SKILLS.md)

### External Resources
- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code/overview)
- [Conventional Commits](https://conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)

### Support
- GitHub Issues: https://github.com/hoadh/rig/issues
- Repository: https://github.com/hoadh/rig

## Unresolved Questions

1. **Performance Benchmarks**: Need baseline metrics for agent execution times
2. **Multi-Repository Support**: How to handle projects spanning multiple repositories?
3. **Bash Secret Guard**: Add a check for Bash commands that read `.env`, keys and credentials?
4. **Real-Time Collaboration**: How to handle multiple developers using agents on one repo?
