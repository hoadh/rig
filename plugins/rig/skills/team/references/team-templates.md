# Team templates

Common to all: one named teammate per angle or file set, `subagent_type: rig:<agent>`, no `isolation` or `mode` on the spawn, Rig Context Block at the end of every spawn prompt, model per the agent definition unless the user names one. Reports go to the Reports path.

## research <topic> [--researchers N, default 3]
1. Derive N distinct angles from the topic (for example architecture, prior art, risks).
2. `TaskCreate` one task per angle; each asks for a report file.
3. Spawn `rig:researcher` teammates `researcher-1..N`, one angle each.
4. When all report, synthesize one summary with unresolved questions last.

## review <scope> [--reviewers N, default 3]
1. One lens per reviewer: security, performance, test coverage (or edge cases).
2. Spawn `rig:code-reviewer` teammates `reviewer-1..N`; each reports findings with severity and file:line.
3. Dedupe and rank the findings; record disagreements.

## debug <issue> [--debuggers N, default 3]
1. Write one hypothesis per debugger.
2. Spawn `rig:debugger` teammates `debugger-1..N`; tell them to try to disprove each other's theories with `SendMessage`.
3. Report the hypothesis that survives, its evidence and a fix proposal.

## implement <plan-or-feature> [--devs N, default 2]
1. Split the work into tasks with disjoint files; record the files in each task. If the work cannot be split without shared files, use one dev, or plain subagents with `isolation: "worktree"` outside the team.
2. Spawn `rig:implementer` teammates `dev-1..N`. Plan-first: the lead is in plan mode before this step (see SKILL.md).
3. After the devs report, spawn a `rig:tester` teammate, then a `rig:code-reviewer` teammate, on the changed files.
4. The lead merges, runs the full test suite and fixes what is left.
