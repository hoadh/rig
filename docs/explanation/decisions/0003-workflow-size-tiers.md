# ADR 0003: Workflow Size Tiers

**Status**: Accepted
**Date**: 2026-11-04
**Relates to**: [ADR 0001](./0001-agent-state-lives-in-files.md) (plans and reports stay in files). Tier rules live in [orchestration protocol](../../../.claude/skills/implement/references/orchestration-protocol.md) (moved out of `primary-workflow.md` in 1.1); this ADR records why.

## Context

Rig ran every change through one pipeline: `planner`, parallel `researcher` agents, plan files, `tester`, `code-reviewer`, `docs-maintainer`. The 2026-11-04 self-assessment found two costs:

- A one-file fix paid the full pipeline in tokens and wall time.
- The rules leaned on absolute wording ("MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS.") and gave few reasons. The always-loaded files (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`) were 25,603 bytes.

No evidence showed that the full pipeline beats plain Claude Code on small tasks. The benchmark harness in `scripts/benchmark/` exists to measure that. Its first full run is not done yet.

## Decision

Classify each task into one of three tiers before acting.

| Tier | Signal | Process |
|---|---|---|
| Trivial | 1 file or less, obvious fix, no API or schema change | Edit directly, run the relevant tests. No plan, no subagents. |
| Standard | A few files, clear scope | Short plan in chat (or `/rig:plan --fast`), implement in the main session, run tests, one `code-reviewer` pass if logic changed. |
| Large | Multi-phase, cross-cutting, risky | Full pipeline: `/rig:plan` (research, red-team), `/rig:implement`, tester and reviewer gates, docs update. |

Rules that go with the table:

- **Risk beats size.** Auth, data and migrations, infra, and public API or schema changes force Large, even for a one-line change.
- **The user overrides the tier** at any time ("just do it").
- **The main agent does the work.** Subagents are used for context isolation, parallelism, or a review that is not anchored on the agent's own reasoning. They are not the default.
- **Hard limits do not change with the tier.** Failing tests are never skipped or weakened, and secrets are never committed.

The tier table is defined once, in `.claude/skills/implement/references/orchestration-protocol.md` (it was `primary-workflow.md` until 1.1; `core-rules.md` carries a one-line form). `CLAUDE.md`, `AGENTS.md` and the implement skill point to it.

## Why small work runs without subagents

- A subagent sees only the prompt the main agent writes. For a small change, the briefing, the subagent's own reads and its summary cost more than the edit.
- Trivial and standard work needs neither isolation nor parallelism. The main agent can run the tests and review its own diff.
- The independent review is kept for Large work and for any change that touches logic.

## Evidence

One headless run per tier on 2026-11-04 (raw stream output in `plans/261104-1427-self-assessment-weakness-fixes/reports/phase-03-tier-evidence/`, not committed):

| Tier | Work done | Agent/Task calls | Tool calls |
|---|---|---|---|
| Trivial | One-file edit to a notes file | 0 | 3 |
| Standard | Function and test in `src/math.js` | 0 | 6 |
| Large | Six plan files (`plan.md` and five phases) | 0 | 13 |

Limits of this evidence:

- One run per tier. It shows the routing, not a rate.
- The Large run did not spawn `planner` or researchers. It read the plan skill and wrote the files in the main session. The research and red-team steps of the Large row are not yet confirmed by a run.
- The always-loaded text fell from 25,603 to 13,223 bytes (-48%). Emphasis markers (`NON-NEGOTIABLE`, `NO EXCEPTIONS`, `MANDATORY`) fell from 2 to 0. Tier 1 eval (`always-loaded-shouting-markers.ts`) now fails if they return to `CLAUDE.md`, `AGENTS.md` or `.claude/rules/*.md`.

## Consequences

**Benefits**

- Small tasks spend fewer tokens and no handoffs.
- Each rule states its reason, so the agent can apply it to cases the text does not list.
- Hard limits stay hard, and the verify-on-stop guard ([how-to](../../how-to/configure-verification-and-safety-guards.md)) nudges when code changed without a passing check.

**Costs**

- The tier is a judgment by the model. A hook cannot see the risk, so a large change can be classed as Standard. The risk signals and the user override are the only checks.
- Softer wording relies on the model following it. The test rule is the one that must hold, which is why it stays a hard rule with a reason.

## Alternatives Considered

- **One pipeline for every task.** Consistent, but every edit pays for it, and the rules offered no basis for the cost.
- **Hook-enforced tiers** (block subagent spawns by task size). More reliable on paper, but a hook cannot judge risk, and it adds a second rule engine. Not built.
- **A per-project tier setting.** Pushes the choice onto the user. One table in one file is enough.

## Revisit When

- The full benchmark run (`npm run bench`, 6 tasks x 3 runs x 2 arms) shows Rig losing on cost or time for trivial or standard tasks.
- A Large task is observed to skip research or review.
- A risky change is handled as Standard in practice.
