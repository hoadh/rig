# Rules Layout

Why `plugins/rig/rules/` holds one file, and where the rest of the workflow guidance lives. Read this before you edit a rule.

## Why

A 1.x files install put the rules in `.claude/rules/`, where Claude Code loads every file into every session and subagent. The 2.x plugin injects them instead (see Layout). In 1.0.0 that was five files (about 11 KB), and most of it was task detail a given session never used. Rig 1.1 keeps the always-loaded part to one small file and moves the rest into the skill that uses it. Static always-loaded text (CLAUDE.md, rules, agent and skill descriptions) fell from 35.1 KB to 9.6 KB. The budget test `always-loaded-context-budget.test.cjs` keeps it there.

## Layout

| File | Loaded when | Holds |
|------|-------------|-------|
| `plugins/rig/rules/core-rules.md` (under 1.8 KB, test-enforced) | Every session and subagent | Principles, one line per size tier, naming, file size, secrets, English-only repo, verify before claiming done, privileged steps, remote hosts, language, subagent Status block |
| `plugins/rig/skills/implement/references/orchestration-protocol.md` | `/rig:implement` runs | Full size tiers, implementation, code quality, testing, review, commit and push, docs, debugging, delegation, chaining and parallelism, subagent status protocol, context isolation |
| `plugins/rig/skills/plan/references/plan-organization.md` | `/rig:plan` runs | Plan directory layout, `plan.md`, phase file sections, Pending Live Verification |
| `plugins/rig/skills/docs/references/docs-upkeep-rules.md` | `/rig:docs` runs | When to update docs, read-first rule, roadmap and changelog upkeep, `docs-maintainer` delegation |
| `plugins/rig/skills/team/references/team-coordination.md` | `/rig:team` runs | Teammate file ownership, git safety, communication, task claiming, conflicts, shutdown |
| `plugins/rig/skills/remote/SKILL.md` | `/rig:remote` runs | SSH host resolution with `ssh -G`, the no-user flow, production hosts are read-only |

Each skill that owns a reference links to it from its `SKILL.md`. A reference nobody links to is not read.

## Where each 1.0.0 rule file went

| 1.0.0 file (removed on update) | Now |
|--------------------------------|-----|
| `development-rules.md` | Principles, naming, file size, secrets, English-only repo: core. Language list, code quality, commit detail, helper skills: `orchestration-protocol.md` |
| `primary-workflow.md` | One line per size tier: core. Full tier table, testing, review, debugging, visual explanations: `orchestration-protocol.md` |
| `orchestration-protocol.md` | Delegation, chaining, subagent status protocol, context isolation: `orchestration-protocol.md`. Status report format also in core |
| `documentation-management.md` | Docs upkeep: `docs-upkeep-rules.md`. Plan layout and phase sections: `plan-organization.md` |
| `team-coordination-rules.md` | Moved verbatim to `team-coordination.md` |

Privileged steps and remote host rules are one line each in core. The full text is in `orchestration-protocol.md` and `remote/SKILL.md`.

## Editing rules

- Change always-loaded behavior in `core-rules.md` only, and keep it under its cap.
- Put task detail in the reference of the skill that needs it, and link that reference from the skill.
- Claude Code does not load a plugin's `rules/*.md` on its own. `session-init` injects `rules/core-rules.md` at session start, and `subagent-init` appends it to each subagent's SubagentStart context, because subagents do not inherit the session-start text. `.rig.json` `subagent.injectCoreRules: false` turns the subagent copy off; unset means on in the plugin and off in a 1.x files install (which loads its rules files natively).

## Antigravity

`node scripts/sync-antigravity-agent-dir.cjs` copies `core-rules.md` to `.agent/rules/` and generates `GEMINI.md` from `CLAUDE.md`. `GEMINI.md` points to the same skill references, which are copied under `.agent/skills/`. `team` and `remote` are Claude Code only and are not copied.
