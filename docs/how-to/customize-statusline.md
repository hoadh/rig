# Customize the statusline

Rig's statusline shows the session (model, context, plan limits, cost), the workspace (directory, git, plan) and live activity (tools, subagents, todos). You can turn any item on or off, for all projects or for one project.

## Turn items on or off

In Claude Code, run `/rig:statusline`. It lists every item with what it shows, asks which to turn off or on and where (all projects or this one), then previews the result.

Or use the command directly, in Claude Code or a terminal (outside Claude Code, run `node <plugin root>/bin/rig-statusline`):

```bash
rig-statusline                        # list items: on/off, where it is set, sample, description
rig-statusline --disable cost,duration
rig-statusline --enable duration
rig-statusline --disable git --project .   # this project only (run in the project root)
rig-statusline --reset                # every item back to on
rig-statusline --preview              # render with sample data and your settings
```

Changes show at the next statusline refresh. No restart is needed.

## Where the settings live

`rig-statusline` writes `statuslineItems` in `~/.claude/.rig.json` (all projects) or, with `--project`, in `<project>/.claude/.rig.json`. The project file wins over the global one, in both directions: a project can turn on an item that is off globally.

```json
{
  "statusline": "full",
  "statuslineItems": { "cost": false, "duration": false }
}
```

A missing id is on. `statusline` picks the layout (`full`, `compact`, `minimal`, `none`); a hidden item is hidden in every layout. `rig-statusline` changes only `statuslineItems`, and it does not touch a file that is not valid JSON.

## Items

| Id | Row | Sample | What it shows | Layouts |
|---|---|---|---|---|
| `model` | session | `✦ Opus 5.5` | Model name of the session. | all |
| `agent` | session | `@reviewer` | Agent name next to the model, when the session runs as an agent (`claude --agent`). | all |
| `effort` | session | `▮▮▮▯▯ high` | Reasoning effort level (changes with /effort); the meter shows in full mode only. | all |
| `context` | session | `━━━━────── 42% 84k/200k` | Context window used: bar, percent and tokens (minimal: percent only). | all |
| `limit-5h` | session | `5h ━━──── 38% ↻ 2h 15m` | 5-hour plan usage and time to reset (subscription plans only). | all |
| `limit-7d` | session | `7d 61% ↻ 3d 4h` | 7-day plan usage and time to reset (subscription plans only). | full |
| `cost` | session | `$0.42` | Session cost in USD (API billing only; hidden on subscription plans). | full |
| `duration` | session | `◷ 25m api 8m` | Session wall time and time spent waiting on the API. | full |
| `tokens` | session | `◇ 120k in 18k out` | Total input and output tokens of the session. | full |
| `dir` | workspace | `◆ ~/Work/app` | Current working directory. | all |
| `git` | workspace | `⎇ main` | Git branch. Turning it off also turns off the git state and skips all git calls. | all |
| `git-state` | workspace | `+2 ~3 ⇡1 ⇣0 / ✓` | Staged (+), unstaged (~), ahead (⇡) and behind (⇣) counts after the branch; ✓ when clean. | full, compact |
| `plan` | workspace | `◎ statusline-item-toggles` | Active Rig plan of the session. | full |
| `changes` | workspace | `+120 -34` | Lines added and removed in this session. | full |
| `config` | workspace | `≡ 2 md · 3 rules · 1 mcp · 5 hooks` | Counts of CLAUDE.md files, rules, MCP servers and hooks in effect. | full |
| `vim` | workspace | `[NORMAL]` | Vim mode, when vim keybindings are on. | full |
| `output-style` | workspace | `style:explanatory` | Output style, when not the default. | full |
| `version` | workspace | `v2.1.330` | Claude Code version. | full |
| `tools` | activity | `◐ Bash npm test 12s / tools Read×8 Bash×5` | Running tool with elapsed time, else the most used tools and error count. | full |
| `agents` | activity | `⬡ ○ tester → ● code-reviewer 1 running` | Subagent flow, running and done counts, and the current subagent task. | full |
| `todos` | activity | `▸ Writing tests ━━━━──── 2/4` | Current todo and todo progress. | full |

Turning off `git` also skips all git calls; turning off `config` skips the config scan; turning off `tools`, `agents` and `todos` skips reading the transcript.

## Troubleshooting

- **An item does not hide.** The statusline runs from `~/.claude/rig/runtime/`, which is refreshed when a session starts after a plugin update. Start a new session. Check that `statusLine` in `~/.claude/settings.json` points to that runtime (`rig-init --runtime` sets it).
- **A global change does not show in one project.** That project's `.claude/.rig.json` sets the same item. `rig-statusline` lists the source of each value.
