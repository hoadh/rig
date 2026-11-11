# Codebase Summary

**Last Updated**: 2026-11-06
**Version**: 2.0.8 (unreleased). Last release 2.0.7 (2026-11-11); 1.1.0 on `release/1.x`
**Repository**: [hoadh/rig](https://github.com/hoadh/rig)
**Source**: built from a `repomix` compaction of this tree (`repomix-output.xml`, gitignored, 1,216 files). Regenerate with `npx repomix@1.18.1 --style xml`.

## Overview

Rig is an Agentic-Driven Development toolkit for Claude Code. Rig 2.x ships as a Claude Code plugin from the `rig-marketplace` marketplace. The plugin holds 33 skills, 14 agents, hooks, rules, `bin/` command entrypoints and the `rig-init` setup CLI. The repo also generates an Antigravity copy (`.agent/`, `GEMINI.md`).

## Project Structure

```
rig/
├── .claude-plugin/
│   └── marketplace.json      # marketplace rig-marketplace; plugin entry source = plugins/rig (git-subdir)
├── plugins/rig/              # THE PLUGIN (installed by Claude Code)
│   ├── .claude-plugin/plugin.json
│   ├── agents/               # 14 subagent definitions
│   ├── skills/               # 33 skills (29 /rig:* commands, 4 helpers), plus _shared/ and common/
│   ├── hooks/                # hooks.json, 6 hook scripts, lib/ (29 modules), __tests__/
│   ├── bin/                  # 14 rig-* entrypoints (node shebang; rig-classify-doc is bash)
│   ├── rules/core-rules.md   # always-loaded rules, injected at SessionStart
│   ├── scripts/              # rig-init/, rig-python venv resolver, rig-bin-launcher, shared scripts
│   ├── schemas/              # rig-config.schema.json (.rig.json)
│   └── statusline.cjs        # statusline (items: hooks/lib/statusline-items.cjs, toggled by rig-statusline); copied to ~/.claude/rig/runtime
├── .claude/                  # DEV ONLY (not shipped): settings.json (permissions, attribution), .rig.json,
│                             #   .env.example, .mcp.json.example, rules/ (empty)
├── .agent/                   # Antigravity copy (generated; see GEMINI.md)
├── .github/
│   ├── workflows/            # ci.yml, plugin-validate.yml, antigravity-sync-check.yml
│   └── CODEOWNERS
├── docs/                     # Diataxis: tutorials, how-to, reference, explanation, project (+ devlog, research, assets)
├── guide/                    # SKILLS.md catalog, ENVIRONMENT_RESOLVER.md, checks/
├── scripts/                  # Repo tooling: Antigravity sync, eval, benchmark, plugin version check, install printer
├── plans/                    # Plans and reports (gitignored in this repo)
├── CLAUDE.md                 # Project instructions for Claude Code (rules live in plugins/rig/rules/)
├── AGENTS.md                 # Project instructions for coding agents
├── GEMINI.md                 # Generated: Antigravity instructions
└── package.json              # Node scripts: test, lint, eval, bench
```

## Core Technologies

### Runtime & Dependencies
- **Node.js**: >=18.0.0 (plugin runtime). Contributors running `npm run lint` need Node 20.19+, 22.13+ or 24+ (ESLint 10)
- **Claude Code**: 2.1.292 floor (`plugin install --marketplace`)
- **Python**: `rig-python` builds a venv from the skills' `requirements.txt` on first use
- **Package Manager**: npm
- **License**: MIT (see `LICENSE`)

### Development Tools
- **ESLint 10**: `npm run lint`, flat config in `eslint.config.mjs`
- **Repomix**: codebase compaction for AI consumption
- **Claude Code CLI**: `claude plugin validate --strict` checks the manifest and marketplace

### CI/CD
- **`ci.yml`**: lint, `npm test` on Ubuntu, Windows and macOS, eval tier 1, pytest for four skill suites
- **`plugin-validate.yml`**: `claude plugin validate` on the 2.1.292 floor and on latest; PR-only plugin version bump check
- **`antigravity-sync-check.yml`**: fails when `.agent/` or `GEMINI.md` drift from a fresh sync, or when a Claude Code-only reference leaks into them
- **Versioning**: `plugins/rig/.claude-plugin/plugin.json` `version` must rise with every plugin change
- **Release**: `scripts/release-plugin.cjs` pins the marketplace entry (ref, sha) and creates the `v<version>` tag; dry run by default, `--apply` in a terminal. `--check-ref` runs in CI

## Key Components

### 1. Agents (14)
`planner`, `researcher`, `brainstormer`, `implementer`, `code-simplifier`, `ui-ux-designer`, `tester`, `code-reviewer`, `debugger`, `progress-tracker`, `docs-maintainer`, `devlog-writer`, `git-operator`, `mcp-runner`. Agents hand work to each other through files in `plans/` and `plans/reports/`.

### 2. Skills (32)
- **Slash commands** (`/rig:<name>`, 28): `brainstorm`, `browser`, `code-review`, `create-skill`, `debug`, `devlog`, `diataxis-writer`, `docs`, `explore`, `fix`, `git`, `implement`, `library-docs`, `markdown-viewer`, `mcp`, `media`, `plan`, `pr`, `progress`, `remote`, `research`, `setup`, `team`, `test`, `ui-design`, `ui-styling`, `visualize`, `worktree`
- **Helpers** (`user-invocable: false`, 4): `context-engineering`, `mermaidjs-v11`, `problem-solving`, `project-organization`
- **Names**: `name:` in each `SKILL.md` has no prefix; Claude Code adds `rig:`. Skills call scripts through `bin/` names, not paths.
- `setup` (new in 2.0) is `disable-model-invocation: true`. It previews `rig-init --plan --json` and prints the terminal commands. It never applies.

### 3. Hooks (6 registrations)
Registered in `plugins/rig/hooks/hooks.json` in exec form (`node` plus `args` with `${CLAUDE_PLUGIN_ROOT}`).

| Event | Script | Role |
|---|---|---|
| SessionStart | `session-init.cjs` | Session context (`additionalContext`), core rules, runtime copy refresh, 1.x coexistence notice |
| SubagentStart | `subagent-init.cjs`, `team-context-inject.cjs` | Dynamic subagent context; teammate context, role skill and team rules |
| TeammateIdle | `teammate-idle-guard.cjs` | One nudge for a teammate's task left `in_progress` |
| UserPromptSubmit | `dev-rules-reminder.cjs` | Rules reminder, once per plan or branch change |
| PreToolUse (Bash) | `bash-safety-guard.cjs` | Asks or denies risky Bash: in-place edits of symlinks, process kills, secret-file reads, `rig-init` apply verbs |
| Stop | `verify-completion-guard.cjs` | Nudges or blocks completion without a passing verification command |

Shared modules: `hooks/lib/` (34 files), such as `plugin-data-dir.cjs` (state and log locations), `global-hook-yields-to-project-copy.cjs` (1.x coexistence), `runtime-copy-to-user-dir.cjs`, `rig-1x-copy-notice.cjs`, `bash-rig-init-destructive-verbs-rule.cjs`. Tests: `hooks/__tests__/` and `hooks/lib/__tests__/`.

### 4. Bin entrypoints (15)
`rig-browser`, `rig-classify-doc`, `rig-init`, `rig-markdown-viewer`, `rig-mcp`, `rig-migrate-docs`, `rig-python`, `rig-remote`, `rig-resolve-env`, `rig-set-active-plan`, `rig-skill-dir`, `rig-statusline`, `rig-ui-search`, `rig-validate-docs`, `rig-worktree`. They sit on the Bash tool PATH. Each one resolves the plugin root from its own real path through `scripts/rig-bin-launcher.cjs`.

### 5. rig-init (setup and migration CLI)
`plugins/rig/scripts/rig-init/` (entry `cli.cjs`, bin `rig-init`).

| Module | Role |
|---|---|
| `cli.cjs` | Verb parser, consent gate (terminal only, outside Claude Code), exit codes |
| `migration-planner.cjs` | Read-only plan per target: settings removals, moves, kept files, committed files, blockers |
| `migration-journal-applier.cjs` | Journaled apply: backup, settings rewrite, moves, resume |
| `backup-restore-standalone.cjs` | Shared primitives; copied into each backup as `restore.cjs` (runs without the plugin) |
| `rig-1x-owned-paths.{json,cjs}` | The 747 1.x files and the command forms that name them; generated by `scripts/generate-rig-1x-owned-paths.cjs` |
| `settings-rig-entries-stripper.cjs` | Removes Rig hook handlers and `statusLine` from settings, returns what it removed |
| `user-settings-permissions-and-runtime.cjs`, `permissions-template.json` | `--permissions` and `--runtime` |
| `skills-dependency-installer-runner.cjs` | `--deps`: runs the skills installer interactively |
| `cc-version-check.cjs` | Warns below the Claude Code floor |

### 6. Remote (`rig:remote`)
`plugins/rig/skills/remote/`: `scripts/remote.cjs` (orchestrator), `worker.cjs` and `worker-commands/`. Worker protocol version 2. The worker runs from `~/.claude/rig/runtime/remote/worker.cjs`. Version gate: `lib/rig-version-compat.cjs`. See [ADR 0002](../explanation/decisions/0002-multi-machine-remote-orchestration.md).

### 7. Antigravity sync
`scripts/sync-antigravity-agent-dir.cjs` builds `.agent/` and `GEMINI.md` from `plugins/rig/` and `CLAUDE.md`. Helpers: `scripts/antigravity/` (frontmatter filter, text rewrite table, leftover check). `--check-leftovers` scans the committed output.

### 8. Tests and evals
- `npm test` runs `scripts/run-hook-tests.cjs`, which discovers every `*.test.cjs` and `*.test.js` under `plugins/rig/` and `scripts/`, and reports passed, failed and skipped counts.
- Guard tests: `scripts/legacy-skill-path-refs-guard.test.cjs` (no 1.x `.claude/` paths in the plugin; allowlist with exact counts) and `plugins/rig/hooks/__tests__/removed-features-reference-scan.test.cjs` (removed features are not named outside history files).
- `scripts/eval/` (tiers 1 to 3, run with bun) and `scripts/benchmark/` (Claude Code with and without Rig).

## Entry Points

### For Users
- Install: `/plugin marketplace add hoadh/rig`, then `/plugin install rig@rig-marketplace` (see [Install and update Rig](../how-to/install-and-update-rig.md))
- Setup: `/rig:setup` in Claude Code, then `rig-init` in a terminal
- Work: `/rig:plan`, `/rig:implement`

### For Developers
- Plugin: `claude --plugin-dir ./plugins/rig`
- Tests: `npm test`; lint: `npm run lint`
- Antigravity: `node scripts/sync-antigravity-agent-dir.cjs`, then `--check-leftovers`

### For Agents
- Core rules: `plugins/rig/rules/core-rules.md`
- Plans: `plugins/rig/skills/plan/references/plan-organization.md`
- Docs upkeep: `plugins/rig/skills/docs/references/docs-upkeep-rules.md`
- Size tiers: `plugins/rig/skills/implement/references/orchestration-protocol.md`

## Development Principles

- **YAGNI, KISS, DRY**: the simplest thing that works
- **File size**: split a file that mixes concerns or passes about 500 lines (data, generated and test files exempt)
- **Security**: validate external input; never commit secrets; the guards catch accidents, they are not a sandbox
- **Real behavior**: tests run real code paths, not mocks that stand in for them

## Testing Strategy

- `npm test` must pass on Linux, Windows and macOS in CI before a merge
- Failing tests are fixed, never skipped or weakened
- Plugin changes: `claude plugin validate ./plugins/rig --strict` and the version bump check
- Checks that need a real Claude Code session, Windows or macOS are `LIVE:` items in each plan phase

## Documentation Standards

- Docs live in `docs/` in the Diataxis layout; index: [docs/README.md](../README.md)
- One primary type per page; `docs/devlog/`, `docs/research/` and `docs/assets/` are not reader docs
- Page size limit: 800 lines

## Version History

- **2.0.0** (2026-11-09): Claude Code plugin, `rig-init`, bin entrypoints, Antigravity sync for the plugin layout. See `CHANGELOG.md`.
- **1.1.0** (2026-11-06), **1.0.0** (2026-10-17): file installer layout (`.claude/` copies). Kept on `release/1.x` and tag `v1.1.0`.

## Open Items

See the [roadmap](../project/roadmap.md).
