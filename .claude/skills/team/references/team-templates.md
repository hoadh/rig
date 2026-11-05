# Team templates

Common: one named teammate per angle or file set, exclusive file ownership, Rig Context Block at the end of every spawn prompt, model per agent definition unless overridden with `model`. Reports go to the Reports path.

## research <topic> [--researchers N, default 3]
1. Derive N distinct angles from the topic (e.g. architecture, prior art, risks).
2. `TaskCreate` one task per angle.
3. Spawn `researcher` teammates named `researcher-1..N`, one angle each; ask for a report file per angle.
4. Wait for completion messages; synthesize one summary with unresolved questions.

## implement <plan-or-feature> [--devs N, default 2] [--plan-approval]
1. Split the plan into tasks with disjoint file ownership; record ownership in each task.
2. Spawn `implementer` teammates `dev-1..N` (use `isolation: "worktree"` when files could overlap).
3. With `--plan-approval`, spawn each dev with `mode: "plan"` so it plans and gets approval before editing.
4. Spawn a `tester` teammate after devs report; then a `code-reviewer` teammate.
5. Lead merges worktree branches (or a dedicated merge teammate with `--delegate`) and runs tests.

## review <scope> [--reviewers N, default 3]
1. Assign one lens per reviewer: security, performance, test coverage (or edge cases).
2. Spawn `code-reviewer` teammates `reviewer-1..N`; each reports findings with severity.
3. Lead dedupes and ranks findings.

## debug <issue> [--debuggers N, default 3]
1. Write one hypothesis per debugger.
2. Spawn `debugger` teammates `debugger-1..N`; tell them to try to disprove each other's theories via `SendMessage`.
3. Lead picks the hypothesis that survives and reports root cause plus fix proposal.
