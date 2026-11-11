# Documentation

Rig docs follow [Diataxis](https://diataxis.fr/): each page has one job. Layout rules: `plugins/rig/skills/docs/references/diataxis-docs-layout.md`.

## Tutorials
- [Getting started](./tutorials/getting-started.md) - install the Rig plugin, plan and build a first feature in a demo project

## How-to guides
- [Install and update Rig](./how-to/install-and-update-rig.md) - plugin install, setup verbs in a terminal, updates, uninstall
- [Migrate from Rig 1.x](./how-to/migrate-from-rig-1x.md) - plan, migrate, resume, restore, team projects, staying on 1.x
- [Extend Rig with agents and skills](./how-to/extend-rig-with-agents-and-skills.md) - add a custom agent or skill, test with `--plugin-dir`, ship a release
- [Configure the verification and safety guards](./how-to/configure-verification-and-safety-guards.md) - verify-on-stop and bash safety hooks, trust ladder, headless off-switch, `/loop` for live evidence
- [Set the response language](./how-to/set-response-language.md) - answer in your language while the repo stays English
- [Customize the statusline](./how-to/customize-statusline.md) - what each statusline item shows, turn items on or off globally or per project (`/rig:statusline`, `rig-statusline`)
- [Release Rig](./how-to/release-rig.md) - version rules, live checks, dry run, tag, push, verify the install (maintainers)
- [Run a plan across machines](./how-to/run-plan-across-machines.md) - dispatch plan phases and tests to macOS, Windows and Linux workers over ssh (`rig-remote`)

## Reference
- [Code standards](./reference/code-standards.md) - conventions for code, files, and markdown docs
- [Agent, skill & hook authoring standards](./reference/agent-skill-hook-authoring-standards.md) - rules for writing plugin components
- [Codebase summary](./reference/codebase-summary.md) - repo structure, plugin layout, components and tests
- [System components](./reference/system-components.md) - catalog of layers, agents, skills, hooks, and technology stack
- [Skills interconnection map](./reference/skills-interconnection-map.md) - how skills call each other
- [Skill native task management](./reference/skill-native-task.md) - the optional Tasks API: which skills use it and why phase files stay the record
- [Agent teams guide](./reference/agent-teams-guide.md) - what Rig adds to Claude Code agent teams, usage, configuration, limits

## Explanation
- [Architecture](./explanation/architecture.md) - plugin layout, rig-init and the consent gate, coexistence with 1.x, how agents and file-based handoffs fit together
- [Antigravity vs Claude Code](./explanation/antigravity-vs-claude-code.md) - concept differences between the two tools and the generated `.agent/` copy
- [Rules layout](./explanation/rules-layout.md) - the one always-loaded rules file, the skill references, and where each moved section went
- [ADR 0001: Agent state lives in files](./explanation/decisions/0001-agent-state-lives-in-files.md) - why agents keep no state outside `plans/`, `docs/` and the session temp file
- [ADR 0002: Multi-machine remote orchestration](./explanation/decisions/0002-multi-machine-remote-orchestration.md) - git as transport, single-writer coordination branch, detached worker runs; extends ADR 0001
- [ADR 0003: Workflow size tiers](./explanation/decisions/0003-workflow-size-tiers.md) - trivial, standard and large tiers; why small work runs without subagents

## Project
- [Overview & PDR](./project/overview-pdr.md) · [Roadmap](./project/roadmap.md) · [Changelog](../CHANGELOG.md)
