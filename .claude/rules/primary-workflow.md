# Primary Workflow

You do the work yourself. Use subagents when they buy something: context isolation, parallelism, or a review not anchored on your own reasoning. Do not delegate by default; every handoff loses detail.

## Size Tiers (single definition; other files point here)

Classify the task before acting. Risk signals (auth, data/migrations, infra, public API or schema change) force Large. The user can always override ("just do it", `/rig:implement --full`).

| Tier | Signal | Process |
|---|---|---|
| Trivial | 1 file or less, obvious fix, no API/schema change | Edit directly, run the relevant tests. No plan, no subagents. |
| Standard | A few files, clear scope | Short plan in chat (or `/rig:plan --fast`), implement in the main session, run tests, one `code-reviewer` pass if logic changed. |
| Large | Multi-phase, cross-cutting, risky | Full pipeline: `/rig:plan` (research, red-team), `/rig:implement`, tester and reviewer gates, docs update. |

## Implementation
- Follow the plan if one exists; otherwise follow the tier process above.
- Update existing files instead of creating "enhanced" copies. Parallel copies drift.
- After changing code, run the compile/typecheck command. Broken builds waste every later step.

## Testing
- Run the relevant tests on the final code. Never skip or weaken a failing test to get green; a hidden failure ships as a bug. No fake data or mocks standing in for real behavior.
- Fix failures and re-run until they pass. Large tier: use the `tester` agent.

## Review
- Review final, tested code. Standard: one pass if logic changed. Large: `code-reviewer` gate.

## Docs and Integration
- Keep API contracts and backward compatibility; document breaking changes.
- Update `./docs` when behavior or structure changes (Large: `docs-maintainer`; none needed for pure internal fixes).

## Debugging
- For CI or server failures use the `debugger` agent (or investigate directly for Trivial/Standard), fix, re-run tests, then review again.

## Visual Explanations
Use `/rig:visualize` (`--explain`, `--diagram`, `--slides`, `--ascii`, `--html`) when the user asks to explain or visualize, or a topic has 3+ interacting components. Output goes to the active plan's `visuals/` folder, else `plans/visuals/`; mermaid syntax via `/mermaidjs-v11`.
