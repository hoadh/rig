# Rig vs vanilla Claude Code benchmark

Measures outcome, cost and time of Claude Code with Rig installed (`rig` arm) against plain Claude Code (`vanilla` arm) on 6 fixed tasks. Fixed before any run; hidden tests decide pass/fail.

## Layout

- `fixture/` - "taskboard", a small Node/TS repo (~1k LOC, tests run with `node --test`, no dependencies, Node >= 24).
- `tasks/*.json` - prompt, expected file scope, hidden-test dir, optional setup overlay per task.
- `hidden-tests/task-N/` - `*.test.ts` copied in only AFTER the agent finishes; `reference.patch` is a reference solution; `setup/` lays a bug (tasks 1 and 3) over the fixture before the agent starts.
- `run-benchmark.ts` - runner; `benchmark-arm-setup.ts` - isolation + Rig install; `benchmark-metrics-collector.ts`; `benchmark-report.ts`; `verify-hidden-tests.ts`.

## Commands

```
npm run bench:verify                       # each hidden test fails on untouched fixture, passes with reference.patch
npm run bench -- --arm both --task 2 --runs 1 --budget 10 --date dry-run   # dry run
npm run bench -- --arm both --task all --runs 3 --budget 100               # full run (36 runs)
npm run bench:report -- <date>             # writes results/<date>/summary.md
```

Options: `--arm vanilla|rig|both`, `--task N|all`, `--runs N`, `--budget USD` (required, cumulative hard cap, aborts the run loop), `--run-cap USD` (per-run `--max-budget-usd`, default 8), `--timeout-min` (default 20), `--model`, `--date`, `--keep`.
Runs are sequential and resumable: cells already in `results/<date>/runs.ndjson` are skipped.

## Isolation

- Each run gets a fresh temp workspace (fixture copy, own git baseline) and a temp `CLAUDE_CONFIG_DIR` containing only the copied `.credentials.json` (or `ANTHROPIC_API_KEY` from env). The operator's `~/.claude` is never read; the runner asserts this before starting.
- `vanilla`: no `.claude/`, no `CLAUDE.md`. `rig`: the plugin of THIS checkout, loaded with `claude --plugin-dir plugins/rig` (the 1.x file installer is retired; no skill dependency packs, no CLAUDE.md in the workspace).
- Same model, same CLI version (recorded per run), same allowlist: `--permission-mode acceptEdits` plus `Bash(npm test|npm run|node|git status|git diff|git log)`.
- Not isolated: managed/enterprise policy files outside the home dir (e.g. `/etc/claude-code`), and the account's server-side settings.

## Metrics (per run, `runs.ndjson`)

Hidden-test pass (all pass + counts), visible-suite result, cost USD and tokens, wall/API time, turns, subagents spawned, permission denials, changed files, out-of-scope files (Rig tooling artifacts counted separately), ESLint errors on changed `.ts` files, exit status.

## Notes

- Raw logs and `runs.ndjson` are git-ignored; commit only `summary.md`.
- 3 runs per cell detect large effects only. Read medians and ranges; make no significance claims.
