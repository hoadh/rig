# Google Antigravity vs Claude Code: Concept Differences

> Research date: Feb 24, 2026

## Overview

Google Antigravity (announced Nov 2025) is an agent-first IDE built as a VS Code fork. Claude Code is Anthropic's terminal-native CLI coding agent. They represent fundamentally different paradigms for AI-assisted development.

## Comparison Table

| Dimension | Antigravity | Claude Code |
|---|---|---|
| **Form factor** | GUI IDE (VS Code fork) | CLI tool (terminal REPL) |
| **Paradigm** | Agent-first — agents are primary interface | Human-first — user drives, AI assists |
| **Autonomy** | 4 levels (full autonomy → review-driven) | Permission-based (auto-allow, ask, plan mode) |
| **Concurrency** | Native multi-agent parallelism via Manager View | Sequential; parallelism via `Task` tool subagents |
| **Execution surfaces** | Editor + Terminal + Browser (3 surfaces) | Terminal only (tools provide file/web access) |
| **Output model** | "Artifacts" — plans, screenshots, recordings, diffs | Direct file edits + text conversation |
| **Feedback loop** | Comment on artifacts; agents revise async | Conversational inline text feedback |
| **Primary model** | Gemini 3 Pro (1M token context) | Claude Opus/Sonnet (200K context) |
| **Multi-model** | Gemini, Claude, GPT-OSS in same session | Claude models only |
| **Browser** | Built-in native execution surface | Via MCP servers (e.g., chrome-devtools) |
| **Knowledge** | Auto-captures patterns, standards, preferences | `CLAUDE.md` files + auto-memory directory |
| **Extensibility** | VS Code extensions (inherited) | MCP servers, hooks, commands, skills, agents |
| **CI/CD** | Not yet detailed | Headless mode, GitHub Actions integration |

## Key Conceptual Differences

### 1. IDE vs CLI
Antigravity is a visual workspace with windows, tabs, and a dashboard. Claude Code is headless — pure text interaction in any terminal.

### 2. Agent-First vs Human-First
Antigravity's core model: **spawn, orchestrate, observe** — multiple agents run asynchronously in parallel workspaces. Claude Code: **single conversation thread** with optional subagent delegation.

### 3. Artifacts vs Conversations
Antigravity introduces artifacts as first-class objects — tangible deliverables (task lists, implementation plans, screenshots, browser recordings, annotated code diffs) that agents produce for user review. Claude Code communicates through direct file mutations and text responses.

### 4. Three Surfaces vs One
Antigravity agents natively span editor + terminal + browser — can scaffold an app, spin up dev server, open browser, run E2E tests, and fix issues without human intervention between steps. Claude Code operates from terminal, accessing browser only through MCP integrations.

### 5. Asynchronous vs Synchronous
Antigravity is designed for "fire and forget" — define a goal, let agents work in background, review later. Claude Code is designed for interactive collaboration — real-time back-and-forth conversation.

### 6. Model Strategy
Antigravity is model-agnostic by design (Gemini 3 Pro primary, plus Claude Sonnet 4.5, GPT-OSS 120B). Claude Code is deeply integrated with Anthropic's Claude models only.

### 7. Knowledge Persistence
Antigravity maintains an automatic persistent knowledge base capturing code patterns, project standards, and team preferences. Claude Code uses explicit file-based mechanisms (`CLAUDE.md`, memory directory).

## Antigravity Performance Benchmarks

- **SWE-bench Verified**: 76.2% (Claude Sonnet 4.5 ~77%)
- **Terminal-Bench 2.0**: 54.2% (vs GPT-5.1's 47.6%)
- **Refactoring accuracy**: 94% vs Cursor's 78%
- **Feature completion speed**: Next.js+Supabase feature in 42s vs Cursor's 68s

## Antigravity Autonomy Levels

1. **Agent-Driven**: Full autonomy on defined goals
2. **Agent-Assisted** (recommended): Verification checkpoints mid-workflow
3. **Review-Driven**: User approval for each step
4. **Custom Configuration**: Task-by-task mode selection

## Where Each Excels

**Antigravity strengths**: Visual orchestration, multi-agent parallelism, browser-native testing, async background work, model flexibility

**Claude Code strengths**: CI/CD integration (headless mode), deep Claude model integration, extensibility (MCP/hooks/skills), lightweight footprint, transparent file-based config, scriptability

## Rig `.claude/` → Antigravity `.agent/` Sync

Rig keeps one source of truth, `.claude/`. `node scripts/sync-antigravity-agent-dir.cjs` regenerates `.agent/` and `GEMINI.md` from it. Do not edit `.agent/` by hand. The release script runs the sync before it packages the kit.

### Mapping

Antigravity's `.agent/` has three layers: **rules** (always on), **workflows** (`/name`) and **skills**. It has no agents, hooks or settings.

| `.claude/` | `.agent/` | How the sync handles it |
|---|---|---|
| `rules/*.md` | `rules/*.md` | Copied with path rewrites. `team-coordination-rules.md` is skipped (Agent Teams only) |
| `CLAUDE.md` | `GEMINI.md` and `rules/project-instructions.md` | Copied without the hook protocol section |
| `skills/<name>/` | `skills/<name>/` | All git-tracked files copied. `rig-plan` → `plan`, `rig-debug` → `debug`. `remote` and `team` are skipped: they need `claude -p` and Agent Teams |
| user-invocable skills | `workflows/<name>.md` | One workflow per skill. `/plan` reads `.agent/skills/plan/SKILL.md`. No `rig:` prefix |
| `agents/*.md` | `agents/*.md` | Kept as role files. "Delegate to `planner`" means: read `agents/planner.md` and do that role |
| `hooks/`, `settings.json`, `output-styles/` | none | Replaced by static defaults in `rules/claude-code-concepts-in-antigravity.md` |

Text rewrites (in `scripts/antigravity/claude-to-antigravity-text-rewrite.cjs`, unit-tested):

* Project paths `.claude/` and `./.claude/` → `.agent/`. User files under `~/.claude/` stay as they are, except `~/.claude/skills/`, which points to `.agent/skills/`.
* `/rig:plan`, `rig:fix` → `/plan`, `fix` for skills that exist in `.agent/`.
* `CLAUDE.md` → `GEMINI.md` in rules.

Only git-tracked files are copied, so `.env` files and virtual environments never reach `.agent/`. The script lists any generated file that still mentions a project `.claude/` path or a `/rig:` command.

### What hooks did, and what replaces them

Claude Code hooks inject context and enforce guards. Antigravity has no hooks, so the concept rule gives static replacements:

| Hook | Job | Replacement in `.agent/` |
|---|---|---|
| `session-init.cjs`, `subagent-init.cjs` | Compute plan dir, reports path and naming pattern | Defaults: `plans/{YYMMDD-HHmm}-{slug}/`, reports in `{plan-dir}/reports/` or `plans/reports/`, files named `{type}-{YYMMDD-HHmm}-{slug}.md` |
| `permissions.ask` in `settings.json` | Prompt before reads of `.env` and credentials | Rule: ask the user before reading them |
| `permissions.deny` in `settings.json` | Block reads of `node_modules`, `.venv`, `__pycache__`, `.next`, `coverage` | Rule: do not search there unless asked |
| `set-active-plan.cjs` steps | Track the active plan | Skipped |

The concept rule also maps tools: `Task`/`Agent` → do the role yourself, `AskUserQuestion` → ask in chat, `TaskCreate`/`TodoWrite` → own task list, `Skill` → read the `SKILL.md`, `$ARGUMENTS` → the text after the command.

### Limits

* The generated kit has not been tested end to end inside Antigravity.
* Skill steps that call `claude -p` (for example the `create-skill` description optimizer) do not work there.
* Some scripts build paths from the string `'.claude'` without a slash. The sync does not rewrite those, so they may look in `.claude/` first.

## Sources
- [Google Developers Blog](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
- [Index.dev](https://www.index.dev/blog/google-antigravity-agentic-ide)
- [VentureBeat](https://venturebeat.com/orchestration/google-antigravity-introduces-agent-first-architecture-for-asynchronous)
- [The New Stack](https://thenewstack.io/hands-on-with-antigravity-googles-newest-ai-coding-experiment/)
- [KDnuggets](https://www.kdnuggets.com/google-antigravity-ai-first-development-with-this-new-ide)
