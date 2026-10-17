# Multi-Machine Planning (`/rig:remote`)

Claude Code only: skip this file where the `remote` skill is not installed (Antigravity has no `rig:remote`).

Decide early whether phases run on other machines, using real ids from the registry and the user's answers. The main agent runs this (subagents cannot ask the user) and passes the result to the planner. This machine is the orchestrator: the machine that runs `/rig:plan` also runs `/rig:implement`.

## 1. Read the registry (local, no ssh)

```
node .claude/skills/remote/scripts/remote.cjs machines --json   # if that file exists in the project
node ~/.claude/skills/remote/scripts/remote.cjs machines --json # otherwise
```

Output: `{ self, registry, found, machines: [{ id, os, shell, allowedTools }] }`. "Other machines" = entries whose `id` differs from `self`. Exit 2 = invalid registry: show the error, continue single-machine unless the user wants to fix it first.

## 2. When to ask

| Situation | Action |
|---|---|
| No other machine, task does not mention other machines | Single-machine plan, ask nothing |
| No other machine, task mentions other machines/OS | Tell the user to set up the registry + `/rig:remote doctor` first (`remote/references/registry-format.md`); plan single-machine or stop, per their answer |
| Other machines exist, task names them or another OS/cross-platform work | Ask (step 3). `--fast`: question 1 only |
| Other machines exist, task looks single-machine | One question: "This machine only (recommended)" vs "Use other machines". `--fast`: skip, single-machine |

## 3. Questions (`AskUserQuestion`, one call)

1. **Machines** (multiSelect): one option per other machine, labelled `<id> (<os>)`. Max 4 options: with more than 4, offer the ones the task names (else the first 4) and let "Other" take any registry id. Reject ids not in the registry.
2. **Per-machine work + test command**, only if the task does not already say it: what each chosen machine does (e.g. "Windows build + tests") and its test command, suggesting one covered by its `allowedTools` (anything else is refused on the worker).

To orchestrate from another machine, the user runs `/rig:plan` there instead. Mention this in the plan summary; do not ask.

## 4. Hand-off to the planner

Planner prompt gets: chosen machines with os, per-machine scope and test command, and the field rules in `output-standards.md` -> Multi-Machine Fields. The planner writes `branch:` in plan.md and NEVER `orchestrator:` (set by `remote dispatch`). Phases for this machine omit `machine` (this machine may not be in the registry).

## 5. Confirm after the plan is written

Check first: every `machine` value is an other-machine id from the registry, `owns` is non-empty and disjoint across machines, same-machine phases are contiguous. Then show `phase | machine (blank = this machine) | owns | dependsOn | test command` and ask once: "Approve (recommended)" / "Change". Edit phase frontmatter per the answer.
