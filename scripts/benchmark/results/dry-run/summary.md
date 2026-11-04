# Rig vs vanilla benchmark - dry-run

Claude Code: 2.1.318 (Claude Code). Model(s): claude-opus-5-5. Runs: 2. Cells show median (min-max). No significance claims: n per cell is small.

| Task | Arm | Runs | Hidden pass | Cost USD | Wall s | Turns | Subagents | Out-of-scope files | Lint errors | Perm. denials | Non-completed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2. feature | vanilla | 1 | 1/1 | $0.30 | 40 | 17 | 0 | 0 | 1 | 2 | 0 |
| 2. feature | rig | 1 | 1/1 | $0.42 | 45 | 13 | 0 | 0 | 0 | 2 | 0 |

## Totals per arm

| Arm | Runs | Hidden pass | Cost USD | Wall s | Turns | Subagents | Out-of-scope files | Lint errors | Perm. denials | Non-completed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vanilla | 1 | 1/1 | $0.30 | 40 | 17 | 0 | 0 | 1 | 2 | 0 |
| rig | 1 | 1/1 | $0.42 | 45 | 13 | 0 | 0 | 0 | 2 | 0 |

- vanilla: total cost $0.30 over 1 runs
- rig: total cost $0.42 over 1 runs

Hidden pass = all hidden tests for the task pass after the agent finished (tests copied in afterwards).
Out-of-scope files exclude Rig tooling artifacts (.claude/, plans/, CLAUDE.md ...).
