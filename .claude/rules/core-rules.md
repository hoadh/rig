# Core Rules

- Principles: YAGNI, KISS, DRY. Do the simplest thing that works.
- Size the process. Trivial (1 file, obvious): edit, run tests, no plan or subagents. Standard (few files): short plan, implement yourself, tests, one review if logic changed, docs if behavior or API changed. Large (multi-phase, cross-cutting): `/rig:plan`, `/rig:implement`, tester and reviewer, docs. Risk signals (auth, data, infra, public API) force Large. User override wins. Full tiers: `.claude/skills/implement/references/orchestration-protocol.md`.
- Names: kebab-case, descriptive (JS/TS/Python/shell); follow the language convention elsewhere.
- File size: split when a file mixes concerns or passes ~500 lines (data, generated, tests exempt).
- Edit existing files; no "enhanced" copies. Real behavior, no mocks standing in for it.
- Commits: conventional, focused, no AI references; lint before commit, tests before push.
- Never commit secrets (dotenv, keys, credentials); a pushed secret is leaked.
- Everything in the repo is English (code, docs, plans, commits, branches). Chat follows the user's language.
- Verify before claiming done: compile, run the relevant tests, report evidence. Never skip or weaken a failing test.
- Privileged steps (sudo, docker, services): prep first, give ONE block with all commands, wait for "done", verify yourself.
- Remote hosts: resolve user/host with `ssh -G <host>`, never guess. Production is read-only without explicit approval.
- Subagent prompts include the work-context root, reports and plans paths when they differ from CWD.
- Subagents end with:
  `**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` / `**Summary:**` / `**Concerns/Blockers:**`
