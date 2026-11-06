# Agent Teams — Orchestration Guide

> Rig 1.1.0 | Claude Code v2.1.33+ | Status: Experimental
> Source: https://code.claude.com/docs/en/agent-teams | Last synced: Feb 5, 2026
> Skill version: 1.1.0 (rewritten: no explicit create or delete team step, teammates spawned with the Agent tool `name`, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)

## Overview

Agent Teams enable multiple **independent Claude Code sessions** working in parallel, coordinated by a lead session. Unlike subagents (Agent tool), teammates have their own context windows, communicate peer-to-peer, and share a task list.

**Use case:** Complex tasks where parallel exploration + inter-agent discussion adds value (research, cross-layer implementation, competing hypotheses).

## Prerequisites

Enable in `settings.json` (may be GA in Claude Code 2.1.33+):
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                     YOUR TERMINAL                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    TEAM LEAD                            │  │
│  │            (your main Claude session)                   │  │
│  │                                                         │  │
│  │  - Spawn named teammates (Agent tool)                    │  │
│  │  - Create & assign tasks (TaskCreate/TaskUpdate)        │  │
│  │  - Spawn teammates (Agent tool with name)              │  │
│  │  - Message teammates (SendMessage)                      │  │
│  │  - Synthesize results                                   │  │
│  │  - Shut down teammates & cleanup                        │  │
│  └──────────┬──────────────┬──────────────┬────────────────┘  │
│             │              │              │                   │
│    ┌────────▼──────┐ ┌────▼────────┐ ┌───▼─────────┐         │
│    │  Teammate A   │ │ Teammate B  │ │ Teammate C  │          │
│    │  (own context)│ │ (own context)│ │ (own context)│        │
│    │               │ │              │ │              │        │
│    │ Can message:  │ │ Can message: │ │ Can message: │        │
│    │ - Lead        │ │ - Lead       │ │ - Lead       │        │
│    │ - B, C        │ │ - A, C       │ │ - A, B       │        │
│    └───────────────┘ └──────────────┘ └──────────────┘        │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  SHARED INFRASTRUCTURE                                   │ │
│  │  ~/.claude/teams/{name}/config.json   <- Team roster     │ │
│  │  ~/.claude/tasks/{name}/              <- Task list       | │
│  │  Mailbox system                       <- Message delivery│ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

| Component | Location | Purpose |
|-----------|----------|---------|
| Team config | `~/.claude/teams/{name}/config.json` | Team membership (name, agentId, agentType) |
| Task list | `~/.claude/tasks/{name}/` | Shared work items with dependencies |
| Lead | Main Claude Code session | Coordinates, assigns, synthesizes |
| Teammates | Separate sessions | Independent workers with full tool access |
| Mailbox | Internal messaging system | Auto-delivery of messages between agents |

**Context inheritance:** Each teammate loads CLAUDE.md, skills, agents, hooks, MCP servers — same as any fresh session. They do **NOT** inherit the lead's conversation history. Include task-specific context in the spawn prompt.

## Rig-Native Behavior

The `/rig:team` skill (1.1.0) is an **imperative execution engine** — templates auto-execute on activation, not a manual playbook.

It automatically integrates with the Rig workflow stack:

| Template | Wraps Workflow | Auto-Injected |
|----------|---------------|---------------|
| `/rig:team research` | `/rig:research` | Report naming, output format |
| `/rig:team implement` | `/rig:implement` | Phase sequence, docs sync eval |
| `/rig:team review` | `/rig:code-review` | Evidence gates, severity ratings |
| `/rig:team debug` | `/rig:fix` | Root-cause-first, adversarial hypotheses |

Teammates automatically receive Rig context (reports path, naming pattern, branch, commit conventions) via the SubagentStart hook (`team-context-inject.cjs`).

## Subagents vs Agent Teams

```
SUBAGENTS (Agent tool)                  AGENT TEAMS (Agent name + SendMessage)
═════════════════════                  ═════════════════════════════

  ┌─────────┐                            ┌─────────┐
  │  LEAD   │                            │  LEAD   │
  └────┬────┘                            └────┬────┘
       │                                      │
  ┌────▼────┐  <- reports back           ┌────▼────┐
  │ Worker  │──────────────┐             │ Worker A│<──────────┐
  └─────────┘              │             └────┬────┘           │
                           │                  │          ┌─────┴────┐
  One-way:                 v             ┌────▼────┐     │ Worker C │
  worker -> lead only    Result          │ Worker B│<--->└──────────┘
                                         └─────────┘
  No worker<->worker                     Multi-way:
  communication                          everyone <-> everyone
```

| Dimension | Subagents | Agent Teams |
|-----------|-----------|-------------|
| Communication | Worker -> Lead only | Any -> Any (peer-to-peer) |
| Context | Own window; results return to caller | Own window; fully independent |
| Coordination | Lead manages all work | Shared task list + self-coordination |
| Token cost | Lower (results summarized back) | Higher (N separate Claude instances) |
| Best for | Quick focused tasks, sequential chains | Complex parallel + discussion |
| User control | Cannot interact with subagents | Can message teammates directly |

**Default rule:** Subagents for focused tasks. Teams for collaborative parallel work requiring discussion.

## Message Flow

```
SendMessage types:
═══════════════════════════════════════════════════════════════

1. "message"  --- Direct 1:1 message
   Lead ────────────> Teammate A
   Teammate A ──────> Teammate B

2. "broadcast" --- Fan-out to ALL (expensive! N = N API calls)
   Lead ────────────> Teammate A
        ────────────> Teammate B
        ────────────> Teammate C

3. "shutdown_request" / "shutdown_response"
   Lead ── shutdown_request ────> Teammate
   Lead <── shutdown_response ── Teammate
                                 (approve=true -> exits gracefully)
                                 (approve=false -> stays, sends reason)

4. "plan_approval_response" (for teammates in plan mode)
   Teammate ── ExitPlanMode ──> Lead (sends plan_approval_request)
   Lead ── plan_approval_response ──> Teammate
           (approve=true -> exits plan mode, begins implementation)
           (approve=false + feedback -> revises plan, resubmits)
```

**Key:** Messages auto-deliver to recipients. Lead does not poll. Idle notifications sent automatically when teammate's turn ends.

## Task Lifecycle

```
                    TaskCreate
                        │
                        v
              ┌─────────────────┐
              │     PENDING     │ <- created, unassigned
              │  (owner: none)  │
              └────────┬────────┘
                       │
            TaskUpdate │ (owner + status: in_progress)
                       │
              ┌────────▼────────┐
              │   IN_PROGRESS   │ <- teammate working
              │  (owner: "dev1")│
              └────────┬────────┘
                       │
            TaskUpdate │ (status: completed)
                       │
              ┌────────▼────────┐
              │    COMPLETED    │ <- done, unblocks dependents
              └─────────────────┘

Dependencies:
  Task 2 ──blockedBy──> Task 1
  (Task 2 cannot start until Task 1 completes)
  Task 1 completes -> Task 2 auto-unblocks -> teammate self-claims

Claiming: File locking prevents race conditions when multiple
          teammates try to claim the same task simultaneously.
```

## Team Lifecycle

```
Phase 1: SETUP
══════════════
  User prompt -> Lead spawns named teammates with the Agent tool
                 -> Team config at ~/.claude/teams/{name}/config.json

Phase 2: POPULATE
═════════════════
  Lead calls Agent(name="{name}") x N
              |               |               |
          Teammate A      Teammate B      Teammate C
          (spawned)       (spawned)       (spawned)

Phase 3: WORK
═════════════
  Lead: TaskCreate x M tasks
  Lead: TaskUpdate (assign owner or teammates self-claim)
  Teammates: work -> message lead/peers -> complete tasks
  Lead: monitor, steer, synthesize

Phase 4: SHUTDOWN
═════════════════
  Lead -> SendMessage(shutdown_request) -> each teammate
  Teammate -> SendMessage(shutdown_response, approve=true)
  Teammate process exits

Phase 5: CLEANUP
════════════════
  Lead -> asks each teammate to finish and stop (SendMessage)
  ~/.claude/teams/{name}/  -> deleted
  ~/.claude/tasks/{name}/  -> deleted
  (Wait for all teammates to stop before ending the session)
```

## Display Modes

```
IN-PROCESS (default)                SPLIT PANES (tmux/iTerm2)
════════════════════                ═════════════════════════

┌──────────────────────┐           ┌──────────┬───────────┐
│                      │           │ Lead     │ Teammate A│
│  Single terminal     │           │          │           │
│                      │           │ (your    │ (visible  │
│  Shift+Up/Down:      │           │  main    │  output)  │
│    cycle teammates   │           │  session)│           │
│                      │           ├──────────┼───────────┤
│  Enter: view session │           │Teammate B│ Teammate C│
│  Escape: interrupt   │           │          │           │
│  Ctrl+T: task list   │           │ (click   │ (click    │
│  Shift+Tab: delegate │           │  to talk)│  to talk) │
│    mode (coord only) │           │          │           │
└──────────────────────┘           └──────────┴───────────┘
```

| Mode | Terminal | Setup | Config |
|------|----------|-------|--------|
| `"auto"` (default) | Split if in tmux, else in-process | None | `"teammateMode": "auto"` |
| `"in-process"` | All in one terminal | None | `"teammateMode": "in-process"` |
| `"tmux"` | Each teammate gets own pane | tmux or iTerm2 (`it2` CLI) | `"teammateMode": "tmux"` |

CLI override: `claude --teammate-mode in-process`

### Keyboard Controls (In-Process Mode)

| Key | Action |
|-----|--------|
| `Shift+Up/Down` | Cycle through teammates |
| `Enter` | View selected teammate's session |
| `Escape` | Interrupt teammate's current turn |
| `Ctrl+T` | Toggle task list |
| `Shift+Tab` | Toggle delegate mode (lead = coordination-only) |

## Team Templates

Automatically orchestrated. Lead executes the full sequence on activation.

### Research Team
```
/rig:team research "best caching strategies for our API"
```
- N researcher teammates (haiku, cost-effective). Default N=3.
- No plan approval — read-only work
- Lead synthesizes findings into single report at `{RIG_REPORTS_PATH}/`
- Est. tokens: 150K-300K

### Implement Team
```
/rig:team implement plans/260205-feature/plan.md
```
- Planner + N developers (sonnet) + tester (haiku). Default N=2.
- **Plan approval required** per developer
- File ownership boundaries enforced
- Task dependencies: planner -> devs -> tester
- Docs sync eval mandatory at end
- Est. tokens: 400K-800K

### Review Team
```
/rig:team review src/auth/
```
- N reviewers (haiku) with specific focus areas. Default N=3.
- Security + Performance + Test Coverage
- Evidence-based only — no "seems" or "probably"
- Lead deduplicates and prioritizes findings
- Est. tokens: 100K-200K

### Debug Team
```
/rig:team debug "API returns 500 on concurrent requests"
```
- N debuggers (sonnet) investigating competing hypotheses. Default N=3.
- Adversarial: debuggers challenge each other's theories
- Root cause report with evidence chain
- Est. tokens: 200K-400K

## Event-Driven Monitoring

In v2.0.0, the lead polled `TaskList` every 30s to detect progress — wasting tokens and missing events between polls. v2.1.0 replaces polling with two Claude Code 2.1.33 hook events.

```
BEFORE (v2.0.0): Polling                    AFTER (v2.1.0): Event-Driven
================================             ================================

Lead           Teammates                     Lead        HOOKS       Teammates
┌────────┐    ┌──────────┐                   ┌────────┐ ┌─────────┐ ┌──────────┐
│        │--->│ worker-1 │                   │        │<│TaskCompl│<│ worker-1 │
│        │--->│ worker-2 │                   │        │ │  HOOK   │ └──────────┘
│  LEAD  │    └──────────┘                   │  LEAD  │ ├─────────┤ ┌──────────┐
│        │         │                         │        │<│Teammate │<│ worker-2 │
│        │<--poll--┘ every 30s               │        │ │Idle HOOK│ └──────────┘
│        │<--poll--  (wastes tokens)         └────────┘ └─────────┘
│        │<--poll--  (misses events)              │
└────────┘                                        │ Hook injects context:
                                                  │ "Task #2 done. 3/5 complete."
[X] Burns tokens polling                          │ "worker-2 idle. #4 available."
[X] 30s blind spot                                │
[X] No shutdown detection                         └──> Lead REACTS instantly
                                                  [OK] Zero-cost monitoring
                                                  [OK] Instant reaction
                                                  [OK] Auto shutdown hints
```

### Completion and Idle Events

Claude Code still fires `TaskCompleted` and `TeammateIdle`, but Rig registers no kit handler for them. Progress comes from teammate messages and `TaskList`. The lead checks `TaskList` when a teammate reports done or goes idle.


## Agent Memory

Agents persist knowledge across sessions via `memory` frontmatter in agent definitions.

| Scope | Agents | Storage | Use Case |
|-------|--------|---------|----------|
| `project` | code-reviewer, debugger, tester, planner | `.claude/agent-memory/` (gitignored) | Project-specific patterns, test frameworks, architecture |
| `user` | researcher | `~/.claude/agent-memory/` | Domain knowledge reusable across projects |
| None | code-simplifier, implementer, docs-maintainer, devlog-writer, mcp-runner, ui-ux-designer | No persistence | Session-scoped, stateless |

Memory auto-injects into agent context at session start (first 200 lines of `MEMORY.md`). Agents maintain their own memory files with insights, patterns, and lessons learned.

```
Session 1                              Session 2
═══════════                            ═══════════

tester learns:                         tester already knows:
  "vitest not jest"  ──persist──>        vitest framework
  "coverage > 80%"                       coverage threshold

planner learns:                        planner skips discovery:
  "monorepo with 4    ──persist──>       goes straight to
   submodules"                           phase planning

researcher learns:                     researcher reuses:
  "REST + GraphQL      ──persist──>      API design patterns
   hybrid API"                           (across ALL projects)
                     .claude/
                     agent-memory/
                     ├── tester/MEMORY.md
                     ├── planner/MEMORY.md
                     └── researcher/MEMORY.md  (in ~/.claude/)
```

## Agent Tool Restrictions

Agents no longer list `Task(Explore)` / `Task(researcher)` in `tools:`. Sub-agent spawning is not granted by the allowlist: editing agents rely on the built-in Explore agent from the main session, and read-only or web-facing agents (brainstormer, researcher, code-reviewer, mcp-runner, git-operator) keep minimal allowlists without the Agent tool. Do not use `disallowedTools` on those agents: it would open MCP, Agent, PowerShell and Workflow tools.

## Key Tools

| Tool | Purpose |
|------|---------|
| `Agent(name, subagent_type, prompt)` | Spawn a named teammate |
| `TaskCreate / TaskUpdate / TaskList / TaskGet` | Manage shared tasks (when the Tasks API is available) |
| `SendMessage(type: "message")` | DM a teammate |
| `SendMessage(type: "broadcast")` | Message all (use sparingly) |
| `SendMessage(type: "shutdown_request")` | Request graceful shutdown |
| `SendMessage(type: "plan_approval_response")` | Approve/reject teammate plans |

## File Ownership (Critical)

Each teammate **MUST** own distinct files. Two teammates editing same file = silent overwrites.

```
Task A: "Implement API" -- owns: src/api/*, src/models/*
Task B: "Implement UI"  -- owns: src/components/*, src/pages/*
Task C: "Write tests"   -- owns: tests/* (blocked by A and B)
```

If two tasks need the same file -> restructure tasks or have lead handle the shared file.

## Permissions

All teammates inherit the lead's permission settings at spawn. If lead has `--dangerously-skip-permissions`, all teammates do too. Can change individual teammate modes after spawning, but not at spawn time.

## Error Recovery

| Situation | Action |
|-----------|--------|
| Teammate unresponsive | Check via Shift+Up/Down, send direct message |
| Teammate wrong output | Redirect with corrective message |
| Teammate crashed | Shut down, spawn replacement, reassign task |
| Lead implementing instead of delegating | Enable delegate mode (Shift+Tab) or tell it to wait |
| Task appears stuck | Check if work done, update status manually |
| Abort entire team | "Shut down all teammates. Clean up the team." |
| After /resume or /rewind | In-process teammates lost. Spawn new ones. |

## Limitations

- **Version pairing:** Agent Teams need Claude Code with the experimental flag; the hook events TaskCompleted and TeammateIdle need v2.1.33+. Rig registers no handlers for these events.
- No session resumption for in-process teammates (`/resume`, `/rewind` don't restore them)
- One team per session (finish the current team before starting a new one)
- No nested teams (teammates cannot spawn their own teams)
- Lead is fixed for team lifetime (no promotion/transfer)
- Permissions set at spawn (change individually after)
- Task status can lag — check manually if stuck
- Shutdown can be slow (teammates finish current tool call first)
- Split panes not supported in VS Code terminal, Windows Terminal, or Ghostty

## Hook Integration

| Hook | Event | Purpose |
|------|-------|---------|
| `team-context-inject.cjs` | SubagentStart | Injects team context (peers, tasks) + Rig context (reports, naming, branch) |
| `session-init.cjs` | SessionStart | Exports Rig paths and session vars (`RIG_SESSION_ID`, `RIG_REPORTS_PATH`, `CLAUDE_CODE_TASK_LIST_ID`, ...) |

All hooks follow fail-open design (exit 0 always) and are gated by `isHookEnabled()` in `rig-config-utils.cjs`.

## Related Files

| File | Purpose |
|------|---------|
| `plugins/rig/skills/team/SKILL.md` | Skill definition with imperative templates (1.1.0) |
| `plugins/rig/skills/team/references/team-templates.md` | Team templates (research, implement, review, debug) |
| `plugins/rig/skills/team/references/team-coordination.md` | Teammate behavior rules + Rig conventions |
| `plugins/rig/skills/implement/references/orchestration-protocol.md` | Size tiers and subagent protocol |
| `plugins/rig/hooks/team-context-inject.cjs` | Team + Rig context injection (SubagentStart) |
| `plugins/rig/hooks/session-init.cjs` | Session and Rig path env injection |

## Quick Start

1. Ensure `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set
2. Tell Claude: `/rig:team research "how should we optimize our database queries?"`
3. Watch 3 researchers investigate in parallel
4. Lead synthesizes findings into actionable report
5. Team auto-cleans up when done

> v2.1.0: Event-driven orchestration. Hook-based monitoring replaces polling. Agent memory persists cross-session.
