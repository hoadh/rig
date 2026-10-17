# Documentation

Rig docs follow [Diataxis](https://diataxis.fr/): each page has one job. Layout rules: `.claude/skills/docs/references/diataxis-docs-layout.md`.

## Tutorials
- [Getting started](./tutorials/getting-started.md) - install Rig into a demo project, plan and build a first feature

## How-to guides
- [Install and update Rig](./how-to/install-and-update-rig.md) - install globally or per project, update from git
- [Extend Rig with agents and skills](./how-to/extend-rig-with-agents-and-skills.md) - add a custom agent, skill, or workflow
- [Run a plan across machines](./how-to/run-plan-across-machines.md) - dispatch plan phases and tests to macOS, Windows and Linux workers over ssh (`rig:remote`)

## Reference
- [Code standards](./reference/code-standards.md) - conventions for code, files, and markdown docs
- [Agent, skill & hook authoring standards](./reference/agent-skill-hook-authoring-standards.md) - rules for writing kit components
- [Codebase summary](./reference/codebase-summary.md) - repo structure and key files
- [System components](./reference/system-components.md) - catalog of layers, agents, skills, and technology stack
- [Skills interconnection map](./reference/skills-interconnection-map.md) - how skills call each other
- [Skill native task management](./reference/skill-native-task.md) - which skills use Claude Tasks and how (Vietnamese)
- [Agent teams guide](./reference/agent-teams-guide.md) - team templates, roles, and coordination rules

## Explanation
- [Architecture](./explanation/architecture.md) - how agents, workflows, and file-based handoffs fit together
- [Antigravity vs Claude Code](./explanation/antigravity-vs-claude-code.md) - concept differences between the two tools
- [ADR 0001: Agent state lives in files](./explanation/decisions/0001-agent-state-lives-in-files.md) - why agents keep no state outside `plans/`, `docs/` and the session temp file
- [ADR 0002: Multi-machine remote orchestration](./explanation/decisions/0002-multi-machine-remote-orchestration.md) - git as transport, single-writer coordination branch, detached worker runs; extends ADR 0001

## Project
- [Overview & PDR](./project/overview-pdr.md) · [Roadmap](./project/roadmap.md)
