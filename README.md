# Rig

**Rig — an Agentic-Driven Development toolkit for Claude Code.**

Rig turns Claude Code into a software development crew. Specialized agents plan, research, implement, test, review and document; you steer the direction and approve the gates. Rig ships the agents, skills, hooks, rules and workflows that make that loop repeatable across projects, and across machines.

[Claude Code](https://claude.com/product/claude-code) is Anthropic's CLI for agentic coding ([docs](https://docs.claude.com/en/docs/claude-code/overview)). Rig installs into a project's `.claude/` directory or globally into `~/.claude/`.

## Agentic-Driven Development

Agentic-Driven Development (ADD) is the workflow Rig is built around:

1. **Plan first** — `/rig:plan` writes a phased plan in `plans/` before any code changes.
2. **Agents execute** — `/rig:implement` drives implementation phase by phase, delegating to focused subagents.
3. **Verify continuously** — tester and code-reviewer agents gate every phase; failing tests are fixed, never skipped.
4. **Docs stay in sync** — docs, plans and devlog are updated as part of the loop, not afterwards.
5. **Humans steer** — you choose scope, approve plans and decide when to commit and ship.

## Quick Start

```bash
git clone git@github.com:hoadh/rig.git && cd rig
node scripts/install-kit-from-local-repo.cjs --dir ../my-app   # or --global for every project
cd ../my-app && claude
/rig:plan "implement user authentication"   # then /rig:implement <plan path>
```

New to Rig? Follow [Getting started](./docs/tutorials/getting-started.md). Install options and updates: [Install and update Rig](./docs/how-to/install-and-update-rig.md).

## Documentation

Full index: [docs/README.md](./docs/README.md), organized by [Diataxis](https://diataxis.fr/) (tutorials, how-to, reference, explanation, project).

| Page | What it covers |
|---|---|
| [Getting started](./docs/tutorials/getting-started.md) | Install Rig and build a first feature |
| [Install and update Rig](./docs/how-to/install-and-update-rig.md) | Project vs global install, updates |
| [Run a plan across machines](./docs/how-to/run-plan-across-machines.md) | `rig:remote`: plan phases and tests on macOS, Windows and Linux workers over ssh, with a threat model |
| [Extend Rig with agents and skills](./docs/how-to/extend-rig-with-agents-and-skills.md) | Add your own agents, skills and hooks |
| [System architecture](./docs/explanation/architecture.md) | How agents, workflows and handoffs fit together |
| [Decisions (ADRs)](./docs/explanation/decisions/) | Why agent state lives in files; multi-machine orchestration |
| [Codebase summary](./docs/reference/codebase-summary.md) | Project structure and components |
| [Code standards](./docs/reference/code-standards.md) | Naming, file size, conventions |
| [Skills catalog](./guide/SKILLS.md) | All 32 skills, grouped by task |
| [Project overview and PDR](./docs/project/overview-pdr.md), [Roadmap](./docs/project/roadmap.md) | Goals, requirements, what is next |
| [CHANGELOG](./CHANGELOG.md) | Release notes |

## What Ships

```
├── .claude/
│   ├── agents/             # 14 subagent definitions
│   ├── skills/             # 32 skills (27 slash commands, 5 internal helpers)
│   ├── hooks/              # Session, subagent, team-context and dev-rules reminder hooks
│   │   └── notifications/  # Telegram, Discord, Slack notifications
│   ├── rules/              # Workflow, development and orchestration rules
│   ├── output-styles/      # Coding levels 0-5 (explanation depth)
│   ├── schemas/            # .rig.json config schema
│   └── statusline.cjs      # Status line
├── docs/                   # Project documentation (Diataxis layout)
├── guide/                  # Skills catalog
├── scripts/                # Kit install, release and Antigravity sync scripts
├── CLAUDE.md               # Instructions loaded by Claude Code
├── AGENTS.md               # Agent coordination guidelines
├── .agent/                 # Antigravity copy (rules, skills, workflows)
└── GEMINI.md               # Instructions loaded by Antigravity
```

`.agent/` and `GEMINI.md` are generated from `.claude/` and `CLAUDE.md` by `node scripts/sync-antigravity-agent-dir.cjs`. Edit `.claude/`, then run the sync. Antigravity workflows drop the `rig:` prefix (`/plan`, `/fix`), and `rig:remote` and `rig:team` are Claude Code only. Details: [Antigravity vs Claude Code](./docs/explanation/antigravity-vs-claude-code.md).

## Agents

Subagents live in `.claude/agents/`. They hand work to each other through files in `plans/` and `plans/reports/`, so each one starts with a fresh context.

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
| Parallel work | `/rig:team` (Agent Teams on one machine), `/rig:remote` (workers on other machines) |
| Document | `/rig:docs`, `/rig:devlog`, `/rig:progress`, `/rig:visualize` |

## Workflows

### Feature

```bash
/rig:plan "add real-time notifications"   # researchers run in parallel, planner writes phases
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
R="node ~/.claude/skills/remote/scripts/remote.cjs"
$R doctor                                       # check workers in ~/.claude/rig-machines.json
$R dispatch plans/<dir> plans/<dir>/phase-02-x.md   # detached agent run on the phase's machine
$R status plans/<dir> --wait                    # wait for runs; reports land in plans/<dir>/reports/
$R review plans/<dir> plans/<dir>/phase-02-x.md --sha <sha>   # after you review the diff
$R collect plans/<dir>                          # merge reviewed branches in phase order
```

Worker set-up, the dedicated OS user and known limits: [Run a plan across machines](./docs/how-to/run-plan-across-machines.md).

## Configuration

- **`CLAUDE.md`** — project instructions: architecture, standards, workflows.
- **`.claude/rules/`** — rules the agents follow: YAGNI, KISS, DRY, small files, conventional commits without AI attribution.
- **`~/.claude/.rig.json`** — per-user Rig config (schema: `.claude/schemas/rig-config.schema.json`).

### API keys for `/rig:media`

`/rig:media` analyzes images, audio, video and PDFs with Gemini, and generates media with Gemini or MiniMax. It needs `GEMINI_API_KEY` ([get one](https://aistudio.google.com/apikey)) and, for MiniMax, `MINIMAX_API_KEY`. Keys are resolved in this order:

1. Environment variable
2. In the project: `.claude/skills/media/.env`, then `.claude/skills/.env`, then `.claude/.env`
3. The same three files under `~/.claude/`

Start from `.claude/.env.example` or `.claude/skills/.env.example`, and never commit `.env` files. Check the setup with `python .claude/skills/media/scripts/check_setup.py`.

### MCP servers

Copy `.claude/.mcp.json.example` to `.claude/.mcp.json` and add servers. `/rig:mcp` and the `mcp-runner` agent discover and run their tools, so their schemas stay out of the main session's context. Claude Code itself does not read `.claude/.mcp.json`: to load a server directly into Claude Code, put it in `.mcp.json` at the project root or add it with `claude mcp add`. Example:

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

- `/rig:mcp` and the `mcp-runner` agent run MCP tools through `echo "<task>" | gemini -y -m <model>`. Gemini CLI reads servers from `.gemini/settings.json`, so link it to the Rig config: `mkdir -p .gemini && ln -sf ../.claude/.mcp.json .gemini/settings.json`. Without `gemini`, they fall back to `npx tsx scripts/cli.ts` in `.claude/skills/mcp/scripts/` (run `npm install` there first).
- `/rig:research` and the `researcher` agent search with Gemini. Set `skills.research.useGemini: false` in `.rig.json` to use WebSearch instead.

Install with `npm install -g @google/gemini-cli` and sign in once by running `gemini`. The model comes from `gemini.model` in `.rig.json` (default `gemini-3-flash-preview`). `-y` lets Gemini run every tool call without asking, so only link MCP servers you trust.

### Notifications

A `Stop` hook can post to Telegram, Discord or Slack when a session finishes. Setup guides: `.claude/hooks/notifications/docs/`.

## Contributing

1. Create a feature branch.
2. Follow the ADD loop: plan, implement, test, review.
3. Run the tests for what you changed and update `docs/`.
4. Open a pull request.

Authoring rules: [Agent, skill and hook authoring standards](./docs/reference/agent-skill-hook-authoring-standards.md).

## License

MIT. See [LICENSE](LICENSE).
