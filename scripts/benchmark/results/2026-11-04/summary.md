# Rig vs vanilla benchmark - 2026-11-04

Claude Code: 2.1.318 (Claude Code). Model(s): claude-opus-5-5. Runs: 36. Cells show median (min-max). No significance claims: n per cell is small.

| Task | Arm | Runs | Hidden pass | Cost USD | Wall s | Turns | Subagents | Out-of-scope files | Lint errors | Perm. denials | Non-completed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. trivial | vanilla | 3 | 3/3 | $0.17 ($0.16-$0.17) | 20 (18-22) | 8 (7-8) | 0 (0-0) | 0 | 0 | 2 | 0 |
| 1. trivial | rig | 3 | 3/3 | $0.31 ($0.30-$0.31) | 20 (20-27) | 8 (8-8) | 0 (0-0) | 0 | 0 | 3 | 0 |
| 2. feature | vanilla | 3 | 3/3 | $0.28 ($0.28-$0.30) | 42 (37-42) | 13 (13-14) | 0 (0-0) | 0 | 0 | 6 | 0 |
| 2. feature | rig | 3 | 3/3 | $0.43 ($0.42-$0.44) | 42 (41-69) | 12 (12-15) | 0 (0-0) | 0 | 0 | 5 | 0 |
| 3. debug | vanilla | 3 | 3/3 | $0.24 ($0.20-$0.25) | 32 (30-34) | 10 (7-10) | 0 (0-0) | 0 | 0 | 2 | 0 |
| 3. debug | rig | 3 | 3/3 | $0.38 ($0.32-$0.39) | 33 (27-41) | 10 (7-10) | 0 (0-0) | 0 | 0 | 4 | 0 |
| 4. refactor | vanilla | 3 | 3/3 | $0.26 ($0.23-$0.26) | 32 (29-36) | 12 (11-12) | 0 (0-0) | 0 | 0 | 3 | 0 |
| 4. refactor | rig | 3 | 3/3 | $0.38 ($0.37-$0.39) | 31 (30-37) | 11 (11-12) | 0 (0-0) | 0 | 0 | 3 | 0 |
| 5. security | vanilla | 3 | 2/3 | $0.39 ($0.36-$0.42) | 76 (63-90) | 15 (14-18) | 0 (0-0) | 0 | 0 | 13 | 0 |
| 5. security | rig | 3 | 3/3 | $0.53 ($0.51-$0.57) | 74 (73-80) | 13 (12-19) | 0 (0-0) | 0 | 0 | 13 | 0 |
| 6. large | vanilla | 3 | 3/3 | $0.53 ($0.47-$0.56) | 99 (84-104) | 20 (18-24) | 0 (0-0) | 0 | 0 | 5 | 0 |
| 6. large | rig | 3 | 3/3 | $0.98 ($0.66-$1.01) | 163 (96-165) | 24 (21-30) | 1 (0-1) | 0 | 0 | 9 | 0 |

## Totals per arm

| Arm | Runs | Hidden pass | Cost USD | Wall s | Turns | Subagents | Out-of-scope files | Lint errors | Perm. denials | Non-completed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vanilla | 18 | 17/18 | $0.27 ($0.16-$0.56) | 37 (18-104) | 13 (7-24) | 0 (0-0) | 0 | 0 | 31 | 0 |
| rig | 18 | 18/18 | $0.41 ($0.30-$1.01) | 41 (20-165) | 12 (7-30) | 0 (0-1) | 0 | 0 | 37 | 0 |

- vanilla: total cost $5.54 over 18 runs
- rig: total cost $8.69 over 18 runs

Hidden pass = all hidden tests for the task pass after the agent finished (tests copied in afterwards).
Out-of-scope files exclude Rig tooling artifacts (.claude/, plans/, CLAUDE.md ...).

## Interpretation (n=3 per cell, no significance claims)

- **Outcome:** no measurable quality gain. Rig 18/18, vanilla 17/18 hidden-test passes; the only miss is one vanilla run on task 5 (path traversal, 3/4 tests). One run is within noise.
- **Cost:** Rig costs ~1.5x per run (median $0.41 vs $0.27; total $8.69 vs $5.54). The gap is roughly a fixed ~$0.13-0.15 per run on tasks 1-5, consistent with Rig's always-loaded context (larger cache creation), and grows to ~1.8x on the large task where Rig spawned a subagent in 2 of 3 runs.
- **Time:** equal on tasks 1-5; large task ~1.6x slower with Rig (median 163 s vs 99 s).
- **Scope discipline / lint:** no difference (0 out-of-scope files, 0 lint errors in both arms).
- **Tiers behaved as designed:** 0 subagents on trivial/standard tasks in the Rig arm.
- **Takeaways:** (1) cut always-loaded context further (plan 261104-1530 targets this); (2) the fixture's tasks are too easy to show a quality difference — add harder or multi-session tasks before claiming value; (3) re-run per release to track the cost overhead.
- Permission denials are similar across arms (runner allowlist), not a Rig effect.
