# System Architecture

**Last Updated**: 2026-11-06
**Version**: 2.0.8 (released 2026-11-11; 1.1.0 on `release/1.x`)
**Project**: Rig

## Overview

Rig implements a multi-agent AI orchestration architecture where specialized agents collaborate through a file-based communication protocol. The system enables developers to leverage AI assistance throughout the entire software development lifecycle - from planning and implementation to testing, review, and deployment.

## Architectural Pattern

### Pattern Classification
**Primary Pattern**: Microservices-inspired Agent Architecture
**Secondary Patterns**:
- Command Pattern (slash commands)
- Observer Pattern (agent communication)
- Strategy Pattern (workflow selection)
- Template Method Pattern (agent workflows)

### Design Philosophy
- **Decoupled Agents**: Each agent is independent and specialized
- **File-Based Communication**: Agents communicate via markdown reports
- **Workflow Orchestration**: Coordinated agent execution (sequential/parallel)
- **Configuration-Driven**: Agents and commands defined in markdown
- **AI-First Development**: Leverage AI at every stage of SDLC

## System Components

Rig is organized in layers:

1. Core Layer
2. Agent Layer
3. Command Layer
4. Workflow Layer
5. Skills Layer
6. Integration Layer
7. Data Layer

Full catalog (responsibilities, files, technology stack): [System Components](../reference/system-components.md).

## Plugin Layout (2.0)

Rig 2.x ships as one Claude Code plugin, `rig`, from the `rig-marketplace` marketplace. The repo is the marketplace. The plugin itself is `plugins/rig/`. Nothing is copied into a project or into `~/.claude` by hand.

```
GitHub repo hoadh/rig
├── .claude-plugin/marketplace.json    marketplace rig-marketplace, source: plugins/rig (git-subdir)
└── plugins/rig/                       the plugin (what Claude Code installs)
    ├── .claude-plugin/plugin.json     name, version (semver, bumped per change)
    ├── skills/ agents/                auto-discovered; skill names carry no prefix, /rig: is added by Claude Code
    ├── hooks/hooks.json               hook registrations (exec form: node + args, ${CLAUDE_PLUGIN_ROOT})
    ├── bin/rig-*                      14 command entrypoints, put on the Bash tool PATH
    ├── rules/core-rules.md            the always-loaded rules, injected at session start
    ├── scripts/rig-init/              the setup and migration CLI (rig-init)
    └── statusline.cjs, hooks/lib/     runtime sources, copied out by rig-init --runtime
```

### What runs where

| Piece | How it runs | Notes |
|---|---|---|
| Hooks | `hooks.json`, Node, with `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` set | Session context, subagent context, prompt reminder, bash safety guard (PreToolUse), verify-on-stop (Stop) |
| Core rules | `session-init` returns `rules/core-rules.md` as `additionalContext` | Plugin mode only; the whole session context is capped at 10,000 characters |
| `bin/rig-*` | Bash tool PATH; each launcher finds the plugin root from its own real path | Bash tool calls do not get `CLAUDE_PLUGIN_*` variables, so nothing reads them there |
| Runtime copy | `~/.claude/rig/runtime/` (statusline, remote worker, their libs) | Written by `rig-init --runtime`, refreshed at each session start. Swapped in whole, never downgraded, refused when `VERSION` is missing |
| Hook state | `CLAUDE_PLUGIN_DATA` (hook-private: reminder state, git cache, verify-guard counter, hook log) | Shared session files `rig-session-<id>.json` stay in the OS temp dir, because Bash-run scripts and the statusline read them and do not get the variable |
| Python | `rig-python` uses a venv at `~/.claude/rig/venv`, built once on first use from the skills' `requirements.txt` | A file install (1.x) keeps its venv at `<root>/skills/.venv`. System packages and npm dependencies are not part of this build; `rig-init --deps` runs the full installer |
| Setup and migration | `rig-init` in a terminal only | The only writer of `~/.claude` configuration. See below |

### rig-init and the consent gate

`rig-init` is the only code that changes a user's Claude Code configuration. Its verbs: `--plan [--json]` (read-only), `--migrate [--global|--project <dir>]`, `--resume`, `--restore <dir>`, `--permissions`, `--runtime`, `--deps`.

Every apply verb goes through one gate. It refuses, in this order, when `CLAUDECODE` is set, when stdin or stdout is not a terminal, when the ancestor chain cannot be read, or when any ancestor process is Claude Code. The terminal check comes before the ancestor chain, so a piped or CI run never starts the Windows PowerShell process query (its cold start can take seconds). Otherwise it shows the plan and asks `y/N`. No flag or environment variable skips the question. The gate is a guard against accidents, not a sandbox: the Bash guard rule also asks before any command that would run `rig-init` apply verbs or a backup's `restore.cjs`.

Migration (1.x to 2.x) is journaled:

1. The plan reads `settings.json` and the owned-path list (`rig-1x-owned-paths.json`, 747 `.claude/`-relative files from the 1.0.0 and 1.1.0 trees). Blockers stop it before anything moves.
2. The backup directory (`~/.claude/rig-backups/<project-hash|global>/<timestamp>/`, owner-only) gets the journal, a copy of each settings file it changes, `moved-paths.txt`, and a standalone `restore.cjs`.
3. Settings are rewritten, then files move. Each step is saved first, so `--resume` finishes an interrupted run and a crash at any step leaves settings that never point at a missing file.
4. Restore needs the plugin disabled. It re-adds only the hook handlers and `statusLine` it removed, keeps later user edits, and never overwrites a file.

### Coexistence with 1.x

A 1.x install registers hooks in `~/.claude/settings.json` or the project's settings. The plugin copy yields to a registered 1.x global or project hook with the same event and matcher, so no hook runs twice. `session-init` prints a line pointing to `rig-init --migrate` while such copies exist. Migration removes them.

### Remote workers

The remote worker runs from the runtime copy (`~/.claude/rig/runtime/remote/worker.cjs` on the worker). The worker protocol is version 2. The orchestrator refuses a worker with a different major version or an unknown version, and `doctor` warns on minor drift. Both sides must run the same major version. Details: [ADR 0002](decisions/0002-multi-machine-remote-orchestration.md).

### Antigravity output

`.agent/` and `GEMINI.md` are generated from `plugins/rig/` and `CLAUDE.md` by `scripts/sync-antigravity-agent-dir.cjs`. The sync strips Claude Code-only frontmatter, rewrites bin names and `/rig:` commands to Antigravity paths, and fails when a Claude Code-only reference survives (`--check-leftovers`). Plugin-only behavior (session-context injection, runtime copies, `rig-init`) has no Antigravity equivalent and is described in the concept doc: [Antigravity vs Claude Code](./antigravity-vs-claude-code.md).

### Repo-only files

`.claude/` in this repo holds development settings (permissions, attribution), templates (`.env.example`, `.mcp.json.example`) and the default `.rig.json`. None of it ships. Edit plugin behavior under `plugins/rig/`.

## Component Interactions

### Typical Interaction Flow: Large Feature

Large-tier work (multi-phase, cross-cutting or risky) takes this path. Trivial and standard tasks skip the planner and researchers; see [ADR 0003](decisions/0003-workflow-size-tiers.md).

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ /rig:implement "add auth"
       ↓
┌─────────────────────┐
│   Command Parser    │
└──────┬──────────────┘
       │ Parse command + args
       ↓
┌─────────────────────┐
│  Planner Agent      │
└──────┬──────────────┘
       │ Spawn researchers
       ↓
┌──────────────────────────────────┐
│  Researchers (Parallel)          │
│  - Auth strategies               │
│  - Security best practices       │
│  - Integration patterns          │
└──────┬───────────────────────────┘
       │ Reports to planner
       ↓
┌─────────────────────┐
│  Planner Agent      │
└──────┬──────────────┘
       │ Create plan
       │ Save to ./plans/
       ↓
┌─────────────────────┐
│   Main Agent        │
└──────┬──────────────┘
       │ Read plan
       │ Implement code
       ↓
┌─────────────────────┐
│  Tester Agent       │
└──────┬──────────────┘
       │ Write & run tests
       ↓
┌─────────────────────┐
│ Code Reviewer Agent │
└──────┬──────────────┘
       │ Review quality
       ↓
┌─────────────────────┐
│  Docs Maintainer    │
└──────┬──────────────┘
       │ Update docs
       ↓
┌─────────────────────┐
│ Git Operator Agent  │
└──────┬──────────────┘
       │ Commit & push
       ↓
┌─────────────────────┐
│   User (Result)     │
└─────────────────────┘
```

### Agent Communication Example

```
plans/<plan-name>/reports/251026-from-planner-to-main-auth-plan-report.md
    ↓
Main Agent reads plan
    ↓
Implements features
    ↓
plans/<plan-name>/reports/251026-from-main-to-tester-auth-impl-report.md
    ↓
Tester reads implementation details
    ↓
Runs tests
    ↓
plans/<plan-name>/reports/251026-from-tester-to-main-test-results-report.md
```

## Data Flow Diagrams

### Command Execution Flow

```
User → CLI → Parser → Command Def → Agent Workflow
                                         ↓
                        ┌────────────────┴────────────────┐
                        ↓                                 ↓
                Sequential Execution              Parallel Execution
                        ↓                                 ↓
                Agent A → Agent B → Agent C    Agent A + Agent B + Agent C
                        ↓                                 ↓
                        └─────────────┬───────────────────┘
                                      ↓
                              Collect Results
                                      ↓
                              Present to User
```

### File-Based Communication Flow

```
Agent A (Planner)
    ↓ Writes
./plans/<plan-name>/plan.md
    ↓ Reads
Main Agent
    ↓ Implements
Code Changes
    ↓ Writes
./plans/<plan-name>/reports/251026-from-main-to-tester-impl-report.md
    ↓ Reads
Tester Agent
    ↓ Executes
Tests
    ↓ Writes
./plans/<plan-name>/reports/251026-from-tester-to-main-results-report.md
    ↓ Reads
Main Agent (next steps)
```

### Documentation Update Flow

```
Code change / /rig:docs update
    ↓
Legacy layout? ── yes ──> migrate-docs-to-diataxis-layout.cjs (dry-run → ask → --apply)
    ↓
docs-maintainer (loads diataxis-writer)
    ↓ per page
Pick type → place in tutorials/ | how-to/ | reference/ | explanation/ (or project/)
    ↓
Write / split mixed pages → classify-doc.sh (advisory) → quality checklist
    ↓
Update docs/README.md index
    ↓
validate-docs.cjs (links, code refs, layout warnings)
```

Layout rules: `plugins/rig/skills/docs/references/diataxis-docs-layout.md`.

### Agent State

Agents keep no state outside the file system ([ADR 0001](decisions/0001-agent-state-lives-in-files.md)):

- **Durable**: plans, phase status and reports in `plans/`; docs and devlog in `docs/`. Source of truth across sessions.
- **Session**: active plan in `$TMPDIR/rig-session-<id>.json`, written by `set-active-plan.cjs`; Claude Tasks only when the Tasks API is available (off by default); phase files stay the source of truth.
- **Disposable**: caches in `$TMPDIR/rig-*.json` (git info, usage limits).

### Rules and Skill References

Always-loaded rules are one file, `plugins/rig/rules/core-rules.md`, injected at session start. Task-specific rules live in the skill that uses them (implement, rig-plan, docs, team, remote) and load only when that skill runs. Where each moved section went: [rules layout](./rules-layout.md).

### Parallel Work Isolation

`/rig:team` gives each implementation dev its own git worktree (`isolation: "worktree"`) and assigns file ownership by glob, so parallel agents in one session do not edit the same files. The lead merges the worktree branches at the end. Rules: `plugins/rig/skills/team/references/team-coordination.md`.

### Multi-Machine Execution (rig:remote)

`rig:remote` (`plugins/rig/skills/remote/`, [ADR 0002](decisions/0002-multi-machine-remote-orchestration.md)) runs plan phases and test commands on other machines. One orchestrator owns the plan. Workers run a headless agent per phase in a Rig-dedicated clone. Git is the only data channel; ssh is control only. No agent sits between the orchestrator and a worker: the orchestrator drives the deterministic CLI over ssh.

```mermaid
flowchart LR
    O[Orchestrator<br/>remote.cjs] -- ssh control, JSON on stdin --> W[Worker<br/>worker.cjs + runner]
    O -- "rig-coord/SLUG lock + plan mirror" --> G[(Git origin)]
    W -- "push rig/MACHINE/SLUG" --> G
    O -- "collect: rig-int/SLUG" --> G
```

| Component | Location | Role |
|---|---|---|
| Orchestrator CLI | `scripts/remote.cjs` | register, machines, setup, doctor, run, dispatch, status, cancel, review, collect, takeover |
| Worker CLI | `scripts/worker.cjs` | prepare, baseline, info, start, status, list, cancel, exec, facts |
| Machine registry | `~/.claude/rig-machines.json` (orchestrator only), written by `register` | Machine ids, ssh target, OS, paths; optional `repos` map (origin key -> clone path, one clone per project; a project missing from `repos` gets `no-clone`); no secrets. Format: `plugins/rig/skills/remote/references/registry-format.md` |
| Coordination branch | `rig-coord/<slug>` (orphan, single writer) | Plan mirror and orchestrator lock; claimed by create-only push |
| Worker branch | `rig/<machine>/<slug>` (runner pushes only) | Agent commits after the owns/denylist guard |
| Integration branch | `rig-int/<slug>` (collect only) | Reviewed worker branches merged in phase order |
| Run state | `~/.rig/runs/<runId>/` on each worker | `run.json`, heartbeat, log; the source of run truth (no ledger) |

**Run lifecycle**: dispatch starts a detached process (tmux session `rig-<runId>` on macOS/Linux; scheduled task `rig-<runId>` on Windows, headless S4U by default). The runner checks the owns/denylist guard before every push and pushes whenever HEAD advances. A heartbeat older than 90 s marks the run `lost`.

| Failure | Handling |
|---|---|
| Unreachable worker, protocol mismatch | Exit 5; `doctor` diagnoses; no blind retry |
| Spec branch is not `rig/<self>/<slug>` | Worker rejects the spec before any work starts (exit 2). `self` is `RIG_MACHINE`, or the lowercased hostname |
| Second run on the same clone | Refused at start (`busy`, exit 1). Busy markers are per clone, so runs on other clones of the same machine proceed |
| Coordination fetch error | Fail closed, exit 3 |
| Second orchestrator claims a plan | Refused, exit 3; `takeover` requires user decision |
| Owns violation, denylisted path | `failed:owns-violation`; not pushed; not auto-retried |
| Worker clone config or hooks changed | `failed:hooks-tampered`; clone quarantined |
| Reviewed branch got a new commit | `collect` refuses (`reviewedSha` mismatch) |
| Merge conflict in collect | Exit 4; resolve in `.rig/int-<slug>` and rerun |
| Killed or rebooted worker | Run shows `lost`; re-dispatch with a new run id |

Operator steps: [Run a plan across machines](../how-to/run-plan-across-machines.md).

## Security Architecture

### Security Layers

**Layer 1: Pre-Commit Security**
- Secret scanning (git-operator agent)
- Credential detection
- .gitignore validation
- Environment file exclusion

**Layer 2: Code Security**
- Input validation enforcement
- SQL injection prevention
- XSS protection patterns
- OWASP Top 10 awareness

**Layer 3: Agent Security**
- No logging of sensitive data
- Sanitized error messages
- Secure credential handling
- API key protection

**Layer 4: Communication Security**
- File system permissions
- Report sanitization
- Context isolation
- Clean handoffs
- Remote workers: ssh control only with validated tokens; worker output fenced as UNTRUSTED; owns/denylist guard before push; orchestrator-only review gate (`rig:remote`, ADR 0002)

### Secret Management

**Environment Variables**:
```
.env (local, gitignored)
.env.example (template, committed)
```

**API Keys**:
- Never hardcoded
- Environment variable injection
- Secure storage systems in production

**Credentials**:
- Password hashing (bcrypt, argon2)
- Token-based authentication
- Secure session management

## Scalability Considerations

### Horizontal Scalability

**Parallel Agent Execution**:
- Independent researchers run simultaneously
- No shared state between agents
- File-based coordination
- Scalable to N agents

**Workflow Parallelization**:
- Multiple feature branches
- Concurrent issue resolution
- Parallel test execution
- Independent documentation updates

### Vertical Scalability

**Context Management**:
- Repomix for code compaction
- Selective context loading
- Chunked file processing
- Efficient token usage

**Performance Optimization**:
- Lazy loading of skills
- Cached MCP responses
- Incremental documentation updates
- Optimized file I/O

## Deployment Architecture

### Development Environment

```
Developer Machine
├── Claude Code CLI
├── Claude Code plugin rig (installed from rig-marketplace)
├── ~/.claude/rig/ (runtime copy, venv)
├── Git repository
└── Node.js runtime
```

### CI/CD Pipeline

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

| Job | Runs |
|---|---|
| `lint` | `npm ci`, then `npm run lint` (ESLint 10, `eslint.config.mjs`) |
| `test-node` | `npm test` on Ubuntu, Windows and macOS; the library-docs runner on Ubuntu |
| `eval-tier-1` | `bun scripts/eval/run.ts 1` (static checks, no secrets) |
| `test-python` | pytest for context-engineering, create-skill, media and ui-styling |

Releases are manual:

```
node scripts/release-plugin.cjs                # dry run: checks plugin.json version, clean tree, main, npm test
node scripts/release-plugin.cjs --apply        # terminal only: tags v<version>, commits the pin (ref, sha) on release/v<version>
# the script never pushes: open a pull request for release/v<version>, fast-forward main after CI, then
git push origin main v<version>
```

Step by step, with live checks and verification: [Release Rig](../how-to/release-rig.md). `main` takes changes only through pull requests with green CI (ruleset `main-ci-required`), the pin included. `--allow-branch` lets a beta tag come from a branch other than `main`; the pin then stays on that branch. The entry's `sha` is the release content commit and the tag points at that commit, so a user installing the entry gets exactly the tagged content. There is no zip and no npm publish.

`plugin-validate.yml` runs `claude plugin validate --strict` on `plugins/rig` and the marketplace on the Claude Code floor (2.1.292) and on the latest release, and fails a change to `plugins/rig/**` that does not raise the plugin version. `antigravity-sync-check.yml` runs on every push and PR to `main` and fails when `.agent/` or `GEMINI.md` differ from a fresh sync, or when a Claude Code-only reference survives in them.

### Production Usage

```
User Project
├── docs/ (generated)
├── plans/ (generated)
├── src/ (user code)
└── tests/ (user tests)
```

## Monitoring & Observability

### Agent Activity Tracking

**Logs**:
- Agent invocations
- Command executions
- Workflow progress
- Error occurrences

**Reports**:
- Agent communication files
- Implementation plans
- Research findings
- Test results

**Metrics**:
- Command execution time
- Agent success rates
- Test pass/fail ratios
- Documentation coverage

### Quality Metrics

**Code Quality**:
- Test coverage percentage
- Type safety compliance
- Linting pass rate
- Security scan results

**Process Metrics**:
- Planning to implementation time
- Code review turnaround
- Documentation freshness
- Commit message compliance

## Failure Handling

### Error Recovery Strategies

**Agent Failures**:
- Graceful degradation
- Error reporting to user
- Rollback mechanisms
- Retry logic for transient errors

**Workflow Failures**:
- Checkpoint saving
- Partial progress preservation
- Clear failure messages
- Recovery suggestions

**Communication Failures**:
- File write retries
- Report validation
- Missing report detection
- Timeout handling

## Extension Points

Agents, skills, and workflows are markdown files under `plugins/rig/`, so extending Rig needs no code changes. Steps: [Extend Rig with Agents and Skills](../how-to/extend-rig-with-agents-and-skills.md).

## Performance Considerations

### Optimization Strategies

**Token Efficiency**:
- Repomix for codebase compaction
- Selective context inclusion
- Efficient prompt engineering
- Response caching where possible

**Execution Speed**:
- Parallel agent spawning
- Async file operations
- Lazy skill loading
- Minimal context switching

**Resource Usage**:
- File system efficiency
- Memory management for large files
- Cleanup of temporary files
- Optimized git operations

## Future Architecture Evolution

Rig is developed independently and stays a set of files in the plugin (`plugins/rig/`) with no runtime service. Direction and priorities live in the [Roadmap](../project/roadmap.md). Changes that would add a database, daemon, or remote execution must first revisit [ADR 0001](decisions/0001-agent-state-lives-in-files.md).

## References

### Internal Documentation
- [Project Overview PDR](../project/overview-pdr.md)
- [Codebase Summary](../reference/codebase-summary.md)
- [Code Standards](../reference/code-standards.md)
- [System Components](../reference/system-components.md)
- [ADR 0001: Agent State Lives in Files](decisions/0001-agent-state-lives-in-files.md)
- [Documentation index](../README.md)

### External Resources
- [Claude Code Documentation](https://docs.claude.com/)
- [MCP Documentation](https://modelcontextprotocol.io/)
- [Semantic Versioning](https://semver.org/)

## Unresolved Questions

1. **Concurrent sessions on one plan**: worktrees isolate parallel agents inside one `/rig:team` session, but two separate sessions (or two people) editing the same plan files have no locking. Is worktree discipline enough, or is a lock needed?
2. **Performance baselines**: no measured latency or token baselines per workflow yet (also open in the [PDR](../project/overview-pdr.md) and [Roadmap](../project/roadmap.md)).

Resolved: agent state beyond the file system → no ([ADR 0001](decisions/0001-agent-state-lives-in-files.md)). Revisited: multi-machine execution is now `rig:remote`, git as transport, state still in files ([ADR 0002](decisions/0002-multi-machine-remote-orchestration.md)).
