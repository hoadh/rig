# Rig - Project Roadmap

**Last Updated:** 2026-11-06
**Current Version:** 2.0.0-beta.1 (beta pending, unreleased). Last release 1.1.0 (2026-11-06)
**Repository:** https://github.com/hoadh/rig

Version history lives in [CHANGELOG.md](../../CHANGELOG.md). This roadmap tracks status and plans only.

## Executive Summary

Rig is an orchestration framework for Claude Code: agents, skills, hooks and workflows that plan, build, test and review software with file-based state. 1.1.0 is released (2026-11-06) and stays on `release/1.x`. 2.0 packages Rig as a Claude Code plugin: the file installer is retired, 1.x installs migrate with `rig-init`. 2.0.0 ships after the 2.0.0-beta.N cycle on Linux, Windows and macOS.

## Status at a Glance

| Milestone | Status | Notes |
|-------|--------|-------|
| 1.0.0 | Released (2026-10-17) | Agents, skills, hooks, docs workflow, rig:remote v1, Antigravity copy |
| 1.1.0 | Released 2026-11-06 | Rules moved into skills, thinner skills, Agent Teams rewrite, Tasks API optional, plugin-prefixed agent types. Section below. Follow-ups listed under 1.0.0 |
| 2.0.0 | beta pending (2.0.0-beta.1 unreleased) | Claude Code plugin, `rig-init` setup and migration, bin entrypoints, Antigravity sync for the plugin layout. Section below |

---

## 2.0.0 (beta pending)

Status: **beta pending**. `2.0.0-beta.1` is in the tree and CHANGELOG but not tagged. Live checks that need a real Claude Code session on another OS are still open, listed per phase below. Phases 1 to 4 are built; phase 5 is docs and the release script.

| Phase | Area | Status | Open live check |
|---|---|---|---|
| 1 | Plugin skeleton: `plugins/rig/`, manifests, `hooks/hooks.json`, validate CI, version bump check | Built | Windows Git Bash for `bin/`; real double-fire with a 1.x project copy |
| 2 | `bin/` entrypoints, runtime copy, remote protocol 2 | Built | Linux to Windows worker dispatch (release gate); statusline after a version bump |
| 3 | `rig-init`: plan, migrate, resume, restore, permissions, runtime, deps; `/rig:setup`; consent gate | Built | Migration round trip in a disposable HOME (runbook in the plan reports) |
| 4 | Antigravity sync for the plugin layout | Built | `/plan` workflow in Antigravity |
| 5 | Docs, `release-plugin.cjs`, beta and 2.0.0 tag | In progress | Beta install from the tag on Linux (full), Windows (smoke), macOS (blocking) |

| Item | Status | Notes |
|---|---|---|
| Claude Code plugin with marketplace `rig-marketplace` | Built, beta pending | `/plugin marketplace add hoadh/rig`, `/plugin install rig@rig-marketplace`. Claude Code floor 2.1.292 |
| File installer retired | Done | `install-kit-from-local-repo.cjs` prints the steps; `scripts/install-kit/` removed. 1.x on `release/1.x` |
| 1.x migration | Built | `rig-init --plan`, `--migrate`, `--resume`, `--restore`. Journaled, restorable, never deletes. [How-to](../how-to/migrate-from-rig-1x.md) |
| Setup verbs in a terminal | Built | `rig-init --runtime`, `--permissions`, `--deps`. Refused inside Claude Code. `/rig:setup` only previews |
| Plan 1427 installer dedupe and skill packs | Dropped | Obsolete: the plugin has no copies and ships every skill |
| Release tagging and marketplace pin | Built; beta tag not yet cut | `scripts/release-plugin.cjs` writes ref and sha per tag; CI (`--check-ref`) checks the pin against the latest tag |

Next: tag `2.0.0-beta.1` and install it from GitHub in disposable HOMEs on Linux, Windows and macOS. Fix forward and repeat as `beta.N`. Tag `2.0.0` after the three OS checks pass. 2.1 follow-ups: `--workflow` for implement, `remote status --follow`, a SubagentStop guard (needs Claude Code 2.1.311), plugin `userConfig`, optional skill packs as separate plugins.

---

## 1.1.0 (Released 2026-11-06)

| Area | What ships | Where |
|------|------------|-------|
| Rules | `core-rules.md` (1.7 KB) replaces five rule files; task sections moved into skill references. Map: [rules layout](../explanation/rules-layout.md) | `plugins/rig/rules/`, `plugins/rig/skills/*/references/` |
| Context | Static always-loaded text 35.1 KB to 9.6 KB; `UserPromptSubmit` emits the full block once per plan or branch change | `plugins/rig/hooks/` |
| Skills | A thinking skill and the Stop notification hooks removed; `worktree`, `explore`, `code-review` thinned onto built-in features; `team` rewritten for Agent Teams | `plugins/rig/skills/` |
| Output styles | Level setting and level-based styles removed; use the built-in `/output-style` | `.rig.json` |
| Agents | Dead tool names removed; Tasks API optional; `effort` and `skills` frontmatter | `plugins/rig/agents/` |
| Hooks | Plugin-prefixed agent types normalized (`rig:tester` to `tester`); remote owns-denylist covers plugin paths | `plugins/rig/hooks/lib/agent-type-normalizer.cjs` |
| Installer | Retired rule and output-style files copied to `.bak` before removal | `scripts/install-kit/` (removed in 2.0) |

Released with CI green on Ubuntu, Windows and macOS (PR #2). Still open: Linux and Windows smoke (`/rig:plan`, `/rig:implement`) in a live session; the `rig:remote` loopback tests are flaky on Windows.

## 1.0.0 (Released 2026-10-17)

| Area | What ships | Where |
|------|------------|-------|
| Agents | 14 agent definitions (planner, tester, code-reviewer, docs-maintainer, debugger, and others) | `plugins/rig/agents/` |
| Skills | 31 skills: 27 `/rig:*` slash commands, 4 helpers with `user-invocable: false` | `plugins/rig/skills/`, [catalog](../../guide/SKILLS.md) |
| Hooks | `session-init`, `subagent-init`, `team-context-inject`, `dev-rules-reminder` inject dynamic facts only | `plugins/rig/hooks/` |
| Native guards | Sensitive files: `permissions.ask`. Heavy directories: `permissions.deny`. File naming: rule in `plugins/rig/rules/core-rules.md`. Usage: statusline reads `rate_limits` from stdin | `.claude/settings.json`, `plugins/rig/statusline.cjs` |
| Statusline | Cross-platform Node.js script with tests; modern 256-color layout: context, 5h/7d limits, time/tokens, git state, config, tools/agents/todos | `plugins/rig/statusline.cjs`, `plugins/rig/hooks/lib/__tests__/` |
| Docs workflow | Diataxis layout; `/rig:docs restructure` (alias `refactor`) migrates non-standard layouts; layout-aware validator | `docs/README.md`, `/rig:docs` |
| UI skills | ui-styling targets Tailwind CSS v4; ui-design ships style, palette and stack data | `plugins/rig/skills/ui-styling/`, `plugins/rig/skills/ui-design/` |
| create-skill | Description optimizer runs via `claude -p` with the session auth | `plugins/rig/skills/create-skill/` |
| ADR 0001 | Agent state lives in files | [decision record](../explanation/decisions/0001-agent-state-lives-in-files.md) |
| rig:remote v1 | Plan phases and test commands on macOS, Windows and Linux workers over ssh | see below |
| Antigravity | `scripts/sync-antigravity-agent-dir.cjs` generates `.agent/` and `GEMINI.md` from `.claude/` (30 skills, 25 workflows, agents as role files); CI (`antigravity-sync-check.yml`) fails when they drift | `.agent/`, `GEMINI.md` |
| Release | Manual: `npm test`, then `prepare-release-assets.cjs` builds `dist/rig.zip` for a GitHub Release | `scripts/prepare-release-assets.cjs` |
| Code standards | One 500-line limit for code files | [code standards](../reference/code-standards.md) |

### rig:remote v1 (Multi-Machine Orchestration)

Runs plan phases and test commands on macOS, Windows and Linux workers over ssh. Git is the only data channel, with a single-writer coordination branch `rig-coord/<slug>`.

- Acceptance checked on macOS, Linux and Windows workers. See [ADR 0002, Verification](../explanation/decisions/0002-multi-machine-remote-orchestration.md#verification).
- Threat model: [how-to, Threat model](../how-to/run-plan-across-machines.md#threat-model).

---

## Next

| Item | Status | Notes |
|------|--------|-------|
| Bash guard for secret files | Done (1.1.0) | `bash-safety-guard` asks before Bash readers and copiers (`cat`, `grep`, `source`, `cp`, `curl @file`) touch secret files. Switch: `bashSafetyGuard.rules.secretFileRead`. A seatbelt, not a sandbox. See [how-to](../how-to/configure-verification-and-safety-guards.md) |
| Real lint step in CI | Done (1.1.0) | `npm run lint` runs ESLint 10 (`eslint.config.mjs`). `.github/workflows/ci.yml` runs lint, all Node suites on Ubuntu, Windows and macOS, eval tier 1 and the Python skill tests. Make the jobs required checks in GitHub settings |
| Workflow size tiers and rule tone | Done (1.1.0) | Trivial, standard and large tiers replace "plan first for everything"; always-loaded text down 48% (1427), then to 9.6 KB static in 1.1 (from 35.1 KB). See [ADR 0003](../explanation/decisions/0003-workflow-size-tiers.md) |
| Rig vs vanilla benchmark harness | Done (1.1.0) | `npm run bench`, `bench:verify`, `bench:report`. Full run (36 runs) not yet done; no results published. See [scripts/benchmark/README.md](../../scripts/benchmark/README.md) |
| Skill tone pass | Not started | Remove emphasis markers and absolutes from the skill bodies outside `implement` (the always-loaded rules are done) |
| Benchmark per release | Not started | Run the full benchmark (6 tasks x 3 runs x 2 arms) before each release; commit `results/<date>/summary.md`; re-score against the 2026-11-04 self-assessment |
| CI hardening | Not started | From the 2026-11-04 review: pin third-party actions by commit SHA; set `bun-version` on `oven-sh/setup-bun`; `persist-credentials: false` on checkout; `cancel-in-progress` only for pull requests (today it also cancels runs of earlier `main` pushes) |
| Node floor for lint | Not started | ESLint 10 needs Node 20.19+, but `package.json` `engines` says `>=18`. Align one with the other |
| rig:remote: worker auth after a Windows reboot | Not started | Only logoff was verified |
| rig:remote: `doctor` between two workers | Not started | No worker-to-worker keys by design |
| rig:remote: per-argument PreToolUse guard | Deferred | Low priority; see ADR 0002 threat model. The generic `bash-safety-guard` does not replace it |
| Verification and safety guards (verify-on-stop hook, bash safety hook, push proof, evidence-based debug reports, live verification items) | Done (1.1.0) | Pending acceptance in live sessions. Follow-ups: SubagentStop verify for `implementer`, tester verdict parsing, `kill $(pgrep -f)`, Windows `taskkill`. See [how-to](../how-to/configure-verification-and-safety-guards.md) |
| rig:remote: `collect` opens a pull request | Not started | Use `/rig:pr` afterwards for now |
| rig:remote: enforce a dedicated worker OS user | Not started | Recommended in v1, not enforced |
| rig:remote: guided worker setup (`register`, `setup`, doctor `fix:` hints) | Done (1.1.0) | Installing Rig, ssh keys and claude login stay manual |
| rig:remote: worker machine-id check, several projects per worker, per-clone busy lock | Done (1.1.0) | Registry `repos` map keyed by origin; `RIG_MACHINE` placement stays manual. Two-project concurrent run verified at unit level only |

---

## Backlog (Unconfirmed)

No work is tracked for these. Confirm before starting.

| Area | Items |
|------|-------|
| Docs | Tutorial library beyond getting-started; API reference automation |
| Performance | Further token optimization; parallel execution enhancements |
| Windows | Terminal integration; PowerShell Core expansion; WSL2 performance |

---

## Technical Context

- **Runtime:** Node.js >= 18.0.0 (`package.json` engines), Bash, Python 3 for some skill scripts
- **Host:** Claude Code CLI. Antigravity reads `.agent/` and `GEMINI.md`, generated from `.claude/` by `scripts/sync-antigravity-agent-dir.cjs`
- **Dev tooling:** ESLint 10 (devDependencies) for `npm run lint`; tests run with plain Node (`npm test`); CI in `.github/workflows/ci.yml`
- **External services:** GitHub (Actions, releases, PRs via `gh`), no npm publishing (releases are GitHub Releases with `rig.zip`), ssh (rig:remote only)
- **Constraints:** state lives in files ([ADR 0001](../explanation/decisions/0001-agent-state-lives-in-files.md)); agent definitions are Markdown with frontmatter; conventional commits required

Code size, naming and quality rules: [code standards](../reference/code-standards.md). Architecture: [system architecture](../explanation/architecture.md).

---

## Document References

- [Project overview & PDR](./overview-pdr.md)
- [Code standards](../reference/code-standards.md)
- [System architecture](../explanation/architecture.md)
- [Codebase summary](../reference/codebase-summary.md)
- [Documentation index](../README.md)
- [Changelog](../../CHANGELOG.md)

---

**Maintained By:** Rig Team
**Last Review:** 2026-10-17
**Next Review:** at the next release
