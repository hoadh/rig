# ADR 0002: Multi-Machine Remote Orchestration

**Status**: Accepted (v1 scope; real-machine acceptance partly done, see Verification)
**Date**: 2026-10-15 (amended 2026-10-18: several projects per machine; 2026-10-21: no dispatcher subagent)
**Extends**: [ADR 0001: Agent state lives in files](./0001-agent-state-lives-in-files.md)

## Context

[ADR 0001](./0001-agent-state-lives-in-files.md) kept agent state in files and dropped distributed execution as out of scope. Two needs changed that: a plan phase or a test command sometimes must run on another OS (macOS, Windows, Linux), and a multi-phase plan may need several machines working in parallel.

Constraints carried over from ADR 0001: no database, no daemon, no new service to install. The orchestrator and workers must share nothing except a git remote and ssh access.

## Decision

`rig:remote` (`.claude/skills/remote/`) runs a plan across machines. One machine is the **orchestrator** and owns the plan. Other machines are **workers**. The rules:

| Area | Decision |
|---|---|
| Data channel | Git origin is the only data channel. ssh is control only: validated command tokens, JSON on stdin, nonce-framed JSON reply. Workers never see the orchestrator working tree. |
| Orchestration path | The orchestrator calls the deterministic `remote.cjs` CLI directly. No dispatcher subagent sits between the orchestrator and a remote worker (see Alternatives). |
| Coordination | Branch `rig-coord/<slug>`: an orphan branch holding the plan mirror and the orchestrator lock. Single writer. Claim is a push of an orphan root, which cannot fast-forward an existing ref, so two claimants cannot both win. Fetch errors fail closed (exit 3). |
| Machine registry | `~/.claude/rig-machines.json` on the orchestrator only. No secrets; keys that look like secrets are rejected. Optional `repos` map: one clone per project (see amendment). |
| Worker repo | A Rig-dedicated clone per machine per project, used for nothing else. Git config, hooks and info are hashed against a baseline stored outside the clone; drift quarantines the clone (`failed:hooks-tampered`). |
| Run concurrency | At most one agent run and one test run per clone (busy markers keyed by clone). Runs on different clones of one machine proceed in parallel. |
| Branches | `rig/<machine>/<slug>`: the worker runner pushes it whenever HEAD advances. `rig-int/<slug>`: only `collect` writes it. |
| Run lifecycle | Detached. Unix: tmux session `rig-<runId>`. Windows: scheduled task, `headless` (S4U logon) by default, started at once with `schtasks /Run`; `interactive` is an opt-in for GUI work. Run truth lives in worker run dirs (`~/.rig/runs/<runId>/`, heartbeat; no ledger). A heartbeat older than 90 s is `lost`. |
| Push guard | The runner checks `owns` globs and a denylist (CI, hook, agent and editor config) before every push. A denylisted path is writable only when an `owns` glob explicitly reaches into it. |
| Review gate | Only the orchestrator reviews. The worker self-reviews its diff before committing. `collect` refuses a branch whose head differs from the recorded `reviewedSha`. |
| Untrusted text | Worker logs, agent output and test output are written into `reports/` inside UNTRUSTED fences and treated as data, never as instructions. |
| Tool policy | `allowedTools` from the registry can only narrow the baseline. Bypass flags are never used. The tool list is a seatbelt, not a sandbox. |

### Threat model

A worker agent is assumed hostile-capable: prompt injection through repo content, dependencies, test output or the phase text is in scope. The granted test command runs test files the agent writes, so the agent can run any code as the worker's OS user. That path cannot be closed without stopping workers from testing, which defeats their purpose.

So the controls are ranked:

1. **OS user boundary** (recommended, not enforced): a dedicated worker user without personal ssh keys or credentials bounds the damage to the claude token and the repo. This is the only layer that holds against a determined agent.
2. **Push guard and review**: `owns` and denylist checks, the baseline hash and the orchestrator review keep bad content off the integration branch. They see only what is committed; writes outside the repo are invisible to them.
3. **Tool policy**: allowlist plus always-disallowed rules (`git push|config|remote`, `git ... --output`). Text-prefix rules are bypassed by shell quoting; they prevent accidents, not attacks.

Per-argument guards (a PreToolUse hook blocking `--output`, `--no-index`, `commit -F/--template`) were considered and deferred: they would not hurt workers, but every vector they close is already reachable through the test command. Revisit them only for machines that grant no test command.

### Amendment (2026-10-18): several projects per machine

The v1 rule "one clone per machine" becomes "one clone per machine per project". Nothing else in the decision changes; this extends it, so no new ADR.

- The registry may hold `repos: {"<normalized origin>": "<clone path>"}`. The orchestrator resolves the clone from the origin of the project it runs in. A project missing from an existing `repos` map is an error (`no-clone`), never a fallback to another project's clone.
- Workers still receive one resolved clone per run and no registry data, so the worker protocol is unchanged.
- Busy markers moved from one per machine to one per clone (`agent-<hash>`, `test-<hash>`), so two projects on one worker run in parallel while the same clone stays serialized. Legacy `agent.busy`/`test.busy` markers held by a live run are still honored.
- Each clone keeps its own baseline, quarantine and `<clone>-rig-test` directory; the threat model is unchanged.

### Plan fields

Phase files add optional frontmatter, read only by multi-machine plans:

| Field | Meaning |
|---|---|
| `machine` | Machine id that runs the phase (`RIG_MACHINE` value). Absent means local. |
| `owns` | List of path globs the phase may change. Required for remote phases. |
| `dependsOn` | Phase ids whose work must be collected first. |
| `reviewedSha` | Written by `review --sha`. The worker commit the orchestrator approved. |
| `reviewScore` | Optional 0-10 score written by `review --score`. |

## Consequences

**Benefits**

- Git history is the audit trail: every worker commit is pushed, named by machine and slug, and reviewable with `git diff`.
- A dead orchestrator does not strand work. `takeover` moves the lock to another machine, and in-flight runs stay visible through `worker list`.
- No new runtime service. Node.js (no dependencies) plus ssh and git.

**Costs**

- Each worker needs a dedicated clone per project, a registry entry on the orchestrator, key-based ssh, and a logged-in `claude`.
- Windows adds constraints: an absolute `node` path, no parentheses in `pathPrepend` or tool paths, and S4U runs with no desktop.
- `allowedTools` is not a sandbox. A worker agent running project scripts can edit them and run them; the owns guard, env allowlist and review gate are the real controls.
- Same-OS-user residual risks (ssh config, shell rc files, PATH shims) are not covered by the baseline hash.

## Alternatives Considered

- **Extend Claude Code agent teams to other machines**: the team model assumes one local session with shared tasks; cross-machine is not supported.
- **GitHub Actions self-hosted runners**: needs a hosted CI control plane, and it cannot dispatch an interactive agent run with review gates.
- **Long-running SDK daemon on each worker**: adds a service to install and keep alive, against ADR 0001.
- **Shared filesystem (NFS, Syncthing)**: no atomic claim, and worker edits would appear in the orchestrator tree.
- **Write-ahead ledger for run state**: a second source of truth that can diverge from run dirs; rejected in favor of worker-side run files.
- **Dispatcher subagent between orchestrator and workers** (rejected, 2026-10-21): a local agent that relays CLI calls. The worker already runs a headless agent, so this adds an LLM hop (tokens, latency, nondeterminism) only to call a shell CLI. It also moves the safety checks (spec validation, machine-id check, run lock, `allowedTools`) behind a nondeterministic layer, which weakens auditability, and a fresh subagent starts with empty context, not the plan and review gates the orchestrator holds. The real needs are cheaper: long waits use `status --wait` in the background; noisy logs (e.g. xcodebuild) get CLI summaries and error excerpts, with quiet build flags on the worker; failed runs get an on-demand `debugger` subagent.

## Verification

Checked on 2026-10-15 (acceptance report: `plans/261015-1041-rig-remote-multi-machine/reports/acceptance-261015.md`):

- Verified: Windows worker push and `/Run` start (about 4 s after the fix), S4U https remote access, Linux worker tmux runs (`tmux attach -r`), stub and real-agent runs on one Windows and one Linux worker, `review` then `collect` in phase order, lost detection after kill, owns violation, dispatch refused before own work is pushed.
- Also verified: doctor from Windows and Linux to macOS (all checks pass except `auth`, because the macOS keychain is locked over ssh). Windows works as orchestrator after a fix: OpenSSH for Windows `ssh.exe` hangs on pipe stdio, so on win32 ssh uses temp-file stdio. macOS works as a node-detached worker; with `CLAUDE_CODE_OAUTH_TOKEN` in `~/.zshenv`, doctor passes `auth` and a real agent run committed and pushed. On Windows, a real agent ran to completion in `headless` mode with no user logged on, and in `interactive` mode with the user logged on; `interactive` with nobody logged on fails as `failed:not-started`. Takeover from Windows while a Linux-dispatched run was in flight also worked with a stub agent: the old orchestrator's dispatch exits 3, and the new one cancels, re-dispatches and tracks the run until it is done and pushed.
- Not yet verified: auth after a Windows reboot, doctor between two workers (no keys between workers, by choice).

The Not-yet-verified items are described as limitations in the [how-to](../../how-to/run-plan-across-machines.md), not as guarantees.

## Revisit When

- Two people or machines must run agents on the same plan at once and the single-writer lock is a bottleneck.
- Worker trust needs a real sandbox (container or dedicated OS user per agent) rather than the seatbelt.
- Collect should open a PR automatically (currently out of v1).
- The orchestrator routinely has to read raw remote logs (fix the CLI output first), or coordination across 3+ machines becomes complex enough to justify a dispatcher (see Alternatives).
