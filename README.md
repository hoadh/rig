# Rig

**Rig — an Agentic-Driven Development toolkit for Claude Code.**

Rig turns Claude Code into a software development crew. Specialized agents plan, research, implement, test, review and document; you steer the direction and approve the gates. Rig ships the agents, skills, hooks, rules and workflows that make that loop repeatable across projects, and across machines.

[Claude Code](https://claude.com/product/claude-code) is Anthropic's CLI for agentic coding ([docs](https://docs.claude.com/en/docs/claude-code/overview)). Rig 2.x is a Claude Code plugin: one install from the marketplace works in every project, with no copies in `.claude/`.

## Agentic-Driven Development

Agentic-Driven Development (ADD) is the workflow Rig is built around:

1. **Size the process** — the task sets the ceremony. A trivial fix is edited directly; a standard change gets a short plan; a large or risky change (auth, data, infra, public API) gets the full `/rig:plan` pipeline in `plans/`. See [ADR 0003](./docs/explanation/decisions/0003-workflow-size-tiers.md).
2. **Agents execute** — `/rig:implement` drives the work phase by phase. Subagents join when they add isolation, parallelism or an independent review.
3. **Verify continuously** — tests run on the final code; failing tests are fixed, never skipped. Large work adds tester and code-reviewer gates.
4. **Docs stay in sync** — docs, plans and devlog are updated as part of the loop, not afterwards.
5. **Humans steer** — you choose scope, approve plans and decide when to commit and ship.

## Quick Start

Requires Claude Code 2.1.292 or newer. Inside Claude Code:

```text
/plugin marketplace add hoadh/rig
/plugin install rig@rig-marketplace
/rig:setup                                  # previews the terminal setup commands
```

Then, in a terminal (outside Claude Code): `rig-init --runtime` and `rig-init --permissions`. Coming from Rig 1.x? Run `rig-init --plan` first, then follow [Migrate from Rig 1.x](./docs/how-to/migrate-from-rig-1x.md). Staying on 1.x: branch `release/1.x`, tag `v1.1.0`.

```text
cd ../my-app && claude
/rig:plan "implement user authentication"   # then /rig:implement <plan path>
```

New to Rig? Follow [Getting started](./docs/tutorials/getting-started.md). Install, setup and updates: [Install and update Rig](./docs/how-to/install-and-update-rig.md).

## Documentation

Full index: [docs/README.md](./docs/README.md), organized by [Diataxis](https://diataxis.fr/) (tutorials, how-to, reference, explanation, project).

| Page | What it covers |
|---|---|
| [Getting started](./docs/tutorials/getting-started.md) | Install Rig and build a first feature |
| [Install and update Rig](./docs/how-to/install-and-update-rig.md) | Plugin install, setup verbs, updates, uninstall |
| [Migrate from Rig 1.x](./docs/how-to/migrate-from-rig-1x.md) | Move 1.x files out of `~/.claude` and projects, restore, staying on 1.x |
| [Configure the verification and safety guards](./docs/how-to/configure-verification-and-safety-guards.md) | Verify-on-stop and bash safety hooks, config keys, `/loop` for live evidence |
| [Set the response language](./docs/how-to/set-response-language.md) | Chat in your language, repo stays English |
| [Run a plan across machines](./docs/how-to/run-plan-across-machines.md) | `rig:remote`: plan phases and tests on macOS, Windows and Linux workers over ssh, with a threat model |
| [Extend Rig with agents and skills](./docs/how-to/extend-rig-with-agents-and-skills.md) | Add your own agents, skills and hooks |
| [System architecture](./docs/explanation/architecture.md) | How agents, workflows and handoffs fit together |
| [Decisions (ADRs)](./docs/explanation/decisions/) | Why agent state lives in files; multi-machine orchestration; workflow size tiers |
| [Codebase summary](./docs/reference/codebase-summary.md) | Project structure and components |
| [Code standards](./docs/reference/code-standards.md) | Naming, file size, conventions |
| [Skills catalog](./guide/SKILLS.md) | All skills, grouped by task |
| [Project overview and PDR](./docs/project/overview-pdr.md), [Roadmap](./docs/project/roadmap.md) | Goals, requirements, what is next |
| [CHANGELOG](./CHANGELOG.md) | Release notes |

## What Ships

```
├── plugins/rig/            # The Claude Code plugin (what users install)
│   ├── .claude-plugin/     # plugin.json manifest
│   ├── agents/             # 14 subagent definitions
│   ├── skills/             # 33 skills (29 slash commands, 4 internal helpers)
│   ├── hooks/              # hooks.json and the hook scripts (session, subagent, prompt reminder, guards)
│   ├── bin/                # rig-* command entrypoints (on the Bash tool PATH)
│   ├── rules/              # core-rules.md, injected at session start
│   ├── scripts/            # rig-init, runtime copy, venv resolver, shared helpers
│   └── statusline.cjs      # Status line (copied to ~/.claude/rig/runtime by rig-init)
├── .claude-plugin/         # marketplace.json (rig-marketplace)
├── .claude/                # Dev-only: this repo's own settings and templates. Not shipped.
├── docs/                   # Project documentation (Diataxis layout)
├── guide/                  # Skills catalog
├── scripts/                # Release, Antigravity generator, eval, benchmark and test scripts
├── CLAUDE.md               # Instructions loaded by Claude Code
├── AGENTS.md               # Agent coordination guidelines
├── antigravity/rig/        # Generated Antigravity plugin (do not edit by hand)
```

`antigravity/rig/` is generated from `plugins/rig/`. Edit `plugins/rig/`, then regenerate. Antigravity skills drop the `rig:` prefix (`/plan`, `/fix`), and `rig:remote`, `rig:team`, `rig:setup` and `statusline` are Claude Code only. Install the Antigravity plugin with `agy plugin install https://github.com/hoadh/rig/tree/<tag>/antigravity/rig`. Which features work, and how to update or remove the old `.agent/` copy, is in the [Antigravity feature map](./docs/reference/antigravity-feature-map.md).

## Agents

Subagents live in `plugins/rig/agents/`. They hand work to each other through files in `plans/` and `plans/reports/`, so each one starts with a fresh context.

| Area | Agents |
|---|---|
| Plan and research | `planner`, `researcher`, `brainstormer` |
| Build | `implementer`, `code-simplifier`, `ui-ux-designer` |
| Verify | `tester`, `code-reviewer`, `debugger` |
| Track and ship | `progress-tracker`, `docs-maintainer`, `devlog-writer`, `git-operator` |
| Integrations | `mcp-runner` |

Codebase search is a skill, not an agent: `/rig:explore` fans out parallel search agents.

## Skills

The commands you will use most. The [skills catalog](./guide/SKILLS.md) lists all of them.

| Task | Commands |
|---|---|
| Decide and plan | `/rig:brainstorm`, `/rig:research`, `/rig:plan` |
| Build and fix | `/rig:implement`, `/rig:fix`, `/rig:debug` |
| Verify | `/rig:test`, `/rig:code-review` |
| Ship | `/rig:git`, `/rig:pr`, `/rig:worktree` |
| Parallel work | `/rig:team` (Agent Teams on one machine; needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), `/rig:remote` (workers on other machines) |
| Document | `/rig:docs`, `/rig:devlog`, `/rig:progress`, `/rig:visualize` |

## Workflows

### Feature

```bash
/rig:plan "add real-time notifications"   # large tier: researchers run in parallel, planner writes phases
/rig:implement plans/<dir>/plan.md        # code, test and review gates per phase
/rig:docs update                          # sync docs with the change
/rig:git                                  # conventional commit
```

### Bug

```bash
/rig:debug "investigate login failures"   # root cause only, no fix
/rig:fix "login fails after token refresh"
```

### Across machines

`/rig:remote` runs a plan phase or a test command on another OS. Git origin is the only data channel. The orchestrator reviews every worker branch before `collect` merges it. Inside Claude Code, `/rig:remote` drives these steps; the underlying CLI is:

```bash
rig-remote doctor                                       # check workers in ~/.claude/rig-machines.json
$R dispatch plans/<dir> plans/<dir>/phase-02-x.md   # detached agent run on the phase's machine
$R status plans/<dir> --wait                    # wait for runs; reports land in plans/<dir>/reports/
$R review plans/<dir> plans/<dir>/phase-02-x.md --sha <sha>   # after you review the diff
$R collect plans/<dir>                          # merge reviewed branches in phase order
```

Worker set-up, the dedicated OS user and known limits: [Run a plan across machines](./docs/how-to/run-plan-across-machines.md).

## Configuration

- **`CLAUDE.md`** — project instructions: architecture, standards, workflows.
- **`plugins/rig/rules/core-rules.md`** — the rules injected at every session start: YAGNI, KISS, DRY, small files, conventional commits without AI attribution. Task-specific rules live in skill references ([rules layout](./docs/explanation/rules-layout.md)).
- **`~/.claude/.rig.json`** — per-user Rig config (schema: `plugins/rig/schemas/rig-config.schema.json`).

### API keys for `/rig:media`

`/rig:media` analyzes images, audio, video and PDFs with Gemini, and generates media with Gemini or MiniMax. It needs `GEMINI_API_KEY` ([get one](https://aistudio.google.com/apikey)) and, for MiniMax, `MINIMAX_API_KEY`. Keys are resolved in this order:

1. Environment variable
2. In the project: `.claude/skills/media/.env`, then `.claude/skills/.env`, then `.claude/.env`
3. The same three files under `~/.claude/`

Start from the `.env.example` template in the Rig repository, and never commit `.env` files. Check the setup with `rig-python "$(rig-skill-dir media)/scripts/check_setup.py"`.

### MCP servers

Copy the `.mcp.json.example` template from the Rig repository to `.mcp.json` at the project root and add servers. `/rig:mcp` and the `mcp-runner` agent discover and run their tools, so their schemas stay out of the main session's context. Claude Code itself does not read `.claude/.mcp.json`: to load a server directly into Claude Code, put it in `.mcp.json` at the project root or add it with `claude mcp add`. Example:

```json
{
  "mcpServers": {
    "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
    "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"] }
  }
}
```

### Gemini CLI (optional)

Two Rig paths call [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`) first when it is on `PATH`:

- `/rig:mcp` and the `mcp-runner` agent run MCP tools through `echo "<task>" | gemini -y -m <model>`. Gemini CLI reads servers from `.gemini/settings.json`, so link it to the Rig config: `mkdir -p .gemini && ln -sf ../.mcp.json .gemini/settings.json`. Without `gemini`, they fall back to `rig-mcp`, which runs the skill's CLI.
- `/rig:research` and the `researcher` agent search with Gemini. Set `skills.research.useGemini: false` in `.rig.json` to use WebSearch instead.

Install with `npm install -g @google/gemini-cli` and sign in once by running `gemini`. The model comes from `gemini.model` in `.rig.json` (default `gemini-3-flash-preview`). `-y` lets Gemini run every tool call without asking, so only link MCP servers you trust.

### Notifications

Use the built-in `PushNotification` tool or your own `Stop` hook to be notified when a session finishes. For explanation depth use the built-in `/output-style`.

## Benchmark

`npm run bench` runs Claude Code with Rig and without it on six fixed tasks, judged by hidden tests. Method, isolation and options: [scripts/benchmark/README.md](./scripts/benchmark/README.md). No results are published yet.

## Contributing

1. Create a feature branch.
2. Follow the ADD loop, sized by the tier in [ADR 0003](./docs/explanation/decisions/0003-workflow-size-tiers.md): plan, implement, test, review.
3. Run `npm run lint` and `npm test`, plus the tests for what you changed, and update `docs/`. CI runs lint, all Node suites on Ubuntu, Windows and macOS, eval tier 1 and the Python skill tests.
4. Open a pull request.

Authoring rules: [Agent, skill and hook authoring standards](./docs/reference/agent-skill-hook-authoring-standards.md).

## License

MIT. See [LICENSE](LICENSE).
