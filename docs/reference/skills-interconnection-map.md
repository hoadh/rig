# Rig Skills Interconnection Map

> 31 skills · 1 ecosystem

## Core Architecture

Rig's skill system is designed as an **interconnected ecosystem** — not a collection of isolated tools. Skills call each other, delegate subtasks, and compose workflows automatically.

## Dependency Graph

```
implement (orchestrator)
├── plan → research → library-docs
│         → explore (parallel agents)
│         → mermaidjs-v11
├── explore → parallel Explore subagents
├── debug → library-docs, browser, problem-solving, sequential-thinking
├── fix → debug, code-review, problem-solving, sequential-thinking, brainstorm, context-engineering
├── test → browser, media, debug, sequential-thinking
├── code-review → explore (edge-case exploration)
├── ui-design
└── git → context-engineering

team (meta-orchestrator)
├── implement, plan, research
├── code-review, fix, test
└── wraps each as multi-agent template

brainstorm → explore, library-docs, media, sequential-thinking, plan, research
create-skill → library-docs, research
```

## Layer Model

### Layer 1 — Orchestrators
| Skill | Role | Outbound deps |
|-------|------|---------------|
| **implement** | Central orchestrator for all feature implementation | 10+ skills |
| **team** | Multi-session parallel collaboration wrapper | 6 skills |

### Layer 2 — Workflow Hubs
| Skill | Role | Called by | Calls |
|-------|------|----------|-------|
| **plan** | Architecture & planning | implement, team, brainstorm | research, explore, mermaidjs-v11 |
| **explore** | Fast codebase exploration | implement, plan, brainstorm, code-review, fix | parallel Explore agents |
| **debug** | Root cause investigation | implement, fix, test | library-docs, browser, problem-solving, sequential-thinking |
| **fix** | Bug resolution | implement, team | debug, code-review, problem-solving, sequential-thinking, brainstorm, context-engineering |
| **test** | Validation & coverage | implement, team | browser, media, debug, sequential-thinking |
| **code-review** | Quality assurance | implement, fix, team | explore |
| **brainstorm** | Solution ideation | fix | explore, library-docs, media, sequential-thinking, plan, research |

### Layer 3 — Utility Providers
Pure capability providers — referenced by hub skills but don't call other skills.

| Skill | Domain | Referenced by |
|-------|--------|---------------|
| **research** | Knowledge gathering | plan, implement, team, brainstorm, create-skill |
| **library-docs** | External documentation | research, debug, brainstorm, create-skill |
| **sequential-thinking** | Step-by-step analysis | brainstorm, fix, test, debug |
| **problem-solving** | Structured problem decomposition | debug, fix |
| **media** | Image/video/audio analysis | test, brainstorm |
| **browser** | Browser automation | debug, test |
| **context-engineering** | Token management | git, fix |
| **mermaidjs-v11** | Diagram generation | plan |
| **ui-design** | Design intelligence | implement |

### Layer 4 — Standalone Skills
Domain-specific tools operating independently.

`markdown-viewer` · `mcp` · `ui-styling`

## Hub Connectivity (most referenced)

| Skill | Inbound references |
|-------|-------------------|
| explore | 5 (brainstorm, code-review, fix, plan, implement) |
| debug | 3 (fix, test, implement) |
| library-docs | 4 (research, debug, brainstorm, create-skill) |
| sequential-thinking | 4 (brainstorm, fix, test, debug) |
| research | 4 (plan, implement, team, create-skill) |
| media | 2 (test, brainstorm) |
| code-review | 3 (fix, implement, team) |
| plan | 3 (brainstorm, implement, team) |

## Key Architectural Patterns

1. **implement is the nucleus** — mandatory for all feature implementation, orchestrates 10+ skills through the full lifecycle: plan → explore → debug → fix → test → review → git

2. **Hub-and-spoke topology** — orchestrators (implement, team) fan out to workflow hubs (plan, debug, fix, test, review), which fan out to utility providers

3. **Cross-hub references** — fix calls debug, test calls debug, brainstorm calls plan — creating a resilient mesh, not a rigid tree

4. **Utility layer is stateless** — sequential-thinking, problem-solving, library-docs provide pure capabilities without calling other skills, keeping the dependency graph acyclic at the leaf level

5. **team wraps everything** — for multi-session parallel work, team composes implement + plan + research + code-review + fix + test into coordinated agent templates
