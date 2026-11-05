# Orchestration Protocol and Workflow Detail

Moved from the always-loaded rules files (`primary-workflow.md`, `orchestration-protocol.md`, `development-rules.md`). The compact version of the tiers, naming, secrets and verification rules is in `.agent/rules/core-rules.md`.

You do the work yourself. Use subagents when they buy something: context isolation, parallelism, or a review not anchored on your own reasoning. Do not delegate by default; every handoff loses detail.

## Size Tiers (single definition; other files point here)

Classify the task before acting. Risk signals (auth, data/migrations, infra, public API or schema change) force Large even for a one-line change (risk beats size). The user can always override ("just do it", `/implement --full`).

| Tier | Signal | Process |
|---|---|---|
| Trivial | 1 file or less, obvious fix, no API/schema change | Edit directly, run the relevant tests. No plan, no subagents. |
| Standard | A few files, clear scope | Short plan in chat (or `/plan --fast`), implement in the main session, run tests, one `code-reviewer` pass if logic changed. |
| Large | Multi-phase, cross-cutting, risky | Full pipeline: `/plan` (research, red-team), `/implement`, tester and reviewer gates, docs update. |

Review scales with the tier: no reviewer on a one-line fix unless it carries a risk signal; a one-line auth fix is Large and gets a reviewer.

## Implementation
- Follow the plan if one exists; otherwise follow the tier process above.
- Update existing files instead of creating "enhanced" copies. Parallel copies drift.
- After changing code, run the compile/typecheck command. Broken builds waste every later step.
- Follow the structure and standards in `./docs`. Implement real behavior, not simulations or mocks; a mock that passes proves nothing.
- Split a file when it mixes concerns or passes ~500 lines; data, generated and test files are exempt (see `docs/reference/code-standards.md`). Prefer extracted utilities and focused modules over inheritance.
- File names: kebab-case, descriptive enough that Grep/Glob output explains the file (JS/TS/Python/shell). Follow the language convention elsewhere (C#/Java/Kotlin/Swift PascalCase, Go/Rust snake_case).
- Helper skills: `library-docs` for current library docs, `gh` for GitHub, `psql` for Postgres debugging, `media`/`imagemagick` for images and video, `debug` and extended thinking for hard analysis.

## Code Quality
- Code must compile and have no syntax errors; style strictness comes second to readability and productivity.
- Handle errors with try/catch at boundaries and validate external input.

## Testing
- Run the relevant tests on the final code. Never skip or weaken a failing test to get green; a hidden failure ships as a bug. No fake data or mocks standing in for real behavior.
- Fix failures and re-run until they pass. Large tier: use the `tester` agent.

## Review
- Review final, tested code. Standard: one pass if logic changed. Large: `code-reviewer` gate.

## Commit and Push
- Lint before commit, run tests before push. Never ignore a failing test to get a green build.
- Never commit secrets (dotenv files, API keys, credentials): a pushed secret must be treated as leaked.
- Keep commits focused. Conventional commit messages, no AI references.

## Docs and Integration
- Keep API contracts and backward compatibility; document breaking changes.
- Update `./docs` when behavior or structure changes (Large: `docs-maintainer`; none needed for pure internal fixes). Upkeep rules: `.agent/skills/docs/references/docs-upkeep-rules.md`.

## Debugging
- For CI or server failures use the `debugger` agent (or investigate directly for Trivial/Standard), fix, re-run tests, then review again.

## Visual Explanations
Use `/visualize` (`--explain`, `--diagram`, `--slides`, `--ascii`, `--html`) when the user asks to explain or visualize, or a topic has 3+ interacting components. Output goes to the active plan's `visuals/` folder, else `plans/visuals/`; mermaid syntax via `/mermaidjs-v11`.

## Privileged Steps (sudo, docker, system services)
- Do all non-privileged prep first (downloads, config files, checks). Do not ask the user to edit files you can prepare.
- Give the user one fenced block with every privileged command in order, copy-paste runnable, including the exact start/launch command (e.g. `sudo systemctl restart x`, `docker compose up -d`) and how you will verify it.
- Wait for "done", then verify yourself (status, logs, version) and report the evidence.
- Do not interleave privileged requests one at a time; it stalls the user repeatedly.

## Delegation Context
Every subagent prompt includes the work context path (git root of the primary files), reports path (`{work_context}/plans/reports/`) and plans path (`{work_context}/plans/`). If CWD differs from the work context, use the work context paths. Without them, subagents write reports to the wrong project.

## Chaining and Parallelism
- Chain when output feeds the next step: Plan, Implement, Test, Review; or Research, Design, Code, Docs.
- Run in parallel only independent work with non-overlapping files; plan integration points first.

## Subagent Status Protocol
Subagents end with one status:

| Status | Meaning | Controller action |
|---|---|---|
| DONE | Completed | Proceed |
| DONE_WITH_CONCERNS | Completed with doubts | Fix correctness/scope concerns first; note observational ones and proceed |
| BLOCKED | Cannot complete | Change something before retrying: more context, simpler task, stronger model, or escalate. Never retry the same approach |
| NEEDS_CONTEXT | Missing information | Supply it and re-dispatch |

After 3 failures on the same task, escalate to the user.

Report format:
```
**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
**Summary:** [1-2 sentences]
**Concerns/Blockers:** [if applicable]
```

## Context Isolation
Subagents get only what they need, never session history: task, files to read/modify, acceptance criteria, constraints, plan phase text (not the whole plan), work context and reports paths. Write "Implement X per phase-02.md" or "Fix null check in auth.ts:45, cause: missing validation", not "continue where we left off". Coordination stays in the main agent.

## Agent Teams
For multi-session collaboration use `/rig:team` (`.agent/skills/team/SKILL.md`); it is not part of the default flow.
