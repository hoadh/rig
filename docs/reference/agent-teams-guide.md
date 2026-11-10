# Agent Teams with Rig

> Rig 2.0.4 | Claude Code agent teams are experimental | Official guide: https://code.claude.com/docs/en/agent-teams

Claude Code runs agent teams: one lead session and named teammates, each in its own context window, with a mailbox, idle notices, shutdown requests, plan approval and (when the session has the Task tools) a shared task list. Rig does not rebuild any of that. It adds three things:

1. **Which Rig agent plays each role**, through `/rig:team` templates (`rig:researcher`, `rig:code-reviewer`, `rig:debugger`, `rig:implementer`, `rig:tester`).
2. **Each teammate's Rig context**, injected by hooks: the team and peers, the role skill, the team rules, the core rules and the Rig paths.
3. **One quality gate**: a teammate that goes idle with its task still `in_progress` is asked once to close it.

## Set up

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

in `~/.claude/settings.json` (or the shell). Optional:

- `"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"` in the same `env`: gives newer models the Task tools (`TaskCreate`, `TaskList`, ...), so the team gets a shared task list and the idle gate has something to check. Without it, work is assigned in each spawn prompt and tracked by message.
- `"teammateMode": "in-process"` is the default and the mode Rig's hooks reach. Split panes (tmux, iTerm2) run each teammate as a separate session, so the Rig teammate context does not apply there.

Side effect of the flag: any subagent the lead names becomes a teammate. Set the flag to `0` when you want plain named subagents.

## Use

```text
/rig:team research <topic>        [--researchers N]   researchers, one angle each
/rig:team review <PR|diff|path>   [--reviewers N]     security / performance / test coverage
/rig:team debug <issue>           [--debuggers N]     competing hypotheses, try to disprove each other
/rig:team implement <plan>        [--devs N]          devs on disjoint files, then tester, then reviewer
```

Plain language works too ("spawn three reviewer teammates using rig:code-reviewer for PR #15"): the hooks give the same Rig context to any in-process teammate whose agent type is a Rig agent.

Plan first: switch the lead to plan mode (Shift+Tab) before `/rig:team implement`. Teammates spawned then plan before editing; Claude Code approves their plans automatically unless you change a teammate's mode while viewing it.

Talk to a teammate: Up/Down in the agent panel, Enter to view and message it, `x` to stop it, Ctrl+T for the task list.

## What a teammate receives

At spawn and again on every message it handles (Claude Code fires SubagentStart per message):

| Section | From | Content |
|---|---|---|
| `## Core Rules` | `subagent-init` | Rig core rules (plugin install) |
| `## Subagent: rig:<agent>` | `subagent-init` | Paths, plan context, naming for its agent type |
| `## Team Context` | `team-context-inject` | Team name, peers (name and agent type), task counts |
| `## Your role` | `team-context-inject` | "Read `<plugin>/skills/<skill>/SKILL.md`" for each `skills:` preload of its agent, because Claude Code does not apply an agent's `skills` to a teammate; "report findings only" for agents without edit tools |
| `## Team rules` | `team-context-inject` | Task claiming and closing, file ownership, messaging by name, reports path, shutdown |

Claude Code itself applies the agent definition's `tools`, `model` and body, and the project's CLAUDE.md, skills and MCP servers.

## Lead rules (from `/rig:team`)

- Tasks own disjoint files. If the work cannot be split, use one dev, or plain subagents with `isolation: "worktree"` outside the team.
- Never pass `isolation` or `mode` on a teammate spawn: `isolation` turns it into a plain subagent, and per-teammate modes are not supported.
- While teammates work, do not edit their files. After they report: merge, run the tests, fix what is left, synthesize.
- Shut teammates down by asking them (native shutdown request). The team config is removed when the session ends; the task list stays under `~/.claude/tasks/`.

## Configuration

| Key (`.rig.json`) | Effect |
|---|---|
| `hooks.team-context-inject: false` | No team context, role skill or team rules for teammates |
| `hooks.teammate-idle-guard: false` | No idle gate |
| `subagent.injectCoreRules: false` | No core rules for subagents and teammates |

## Limits that matter

- `/resume` and `/rewind` do not bring in-process teammates back; spawn new ones.
- One team per session, no nested teams, the lead is fixed.
- `claude -p` never spawns teammates.
- Teammate permission prompts appear in the lead; pre-approve common commands to avoid interruptions.
- Token cost grows with each teammate. Start with 3-5; research and review are the best first uses.

## Troubleshooting

| Symptom | Check |
|---|---|
| A teammate has no `## Team Context` | Split-pane mode, or `hooks.team-context-inject` off; `~/.claude/teams/session-<8>/config.json` lists it |
| A teammate did not follow its role skill | Its agent type is a Rig agent (`rig:<name>`) with a `skills:` preload; ask it to quote the SKILL.md heading |
| Tasks stay `in_progress` | The session has the Task tools; `hooks.teammate-idle-guard` on; the hook log shows `teammate-idle-guard` |
| The lead implements instead of waiting | Tell it to wait for its teammates to finish |

## Related

- `plugins/rig/skills/team/` (skill, templates, coordination rules)
- `plugins/rig/hooks/team-context-inject.cjs`, `hooks/lib/teammate-role-context.cjs`, `hooks/teammate-idle-guard.cjs`
- [System components](./system-components.md)
