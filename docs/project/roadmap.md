# Rig - Project Roadmap

**Last Updated:** 2026-11-13
**Current Version:** 2.0.10 (2026-11-13); 1.1.0 on `release/1.x`
**Repository:** https://github.com/hoadh/rig

Version history lives in [CHANGELOG.md](../../CHANGELOG.md). This roadmap tracks status and plans only.

## Executive Summary

Rig is an orchestration framework for Claude Code: agents, skills, hooks and workflows that plan, build, test and review software with file-based state. 1.1.0 is released (2026-11-06) and stays on `release/1.x`. 2.0 packages Rig as a Claude Code plugin: the file installer is retired, 1.x installs migrate with `rig-init`. 2.0.0 is released (2026-11-09) after three betas checked on Linux, Windows and macOS. After 2.0, Rig grows into a family of plugins in one marketplace (see [Plugin family](#plugin-family)).

## Status at a Glance

| Milestone | Status | Notes |
|-------|--------|-------|
| 1.0.0 | Released (2026-10-17) | Agents, skills, hooks, docs workflow, rig:remote v1, Antigravity copy |
| 1.1.0 | Released 2026-11-06 | Rules moved into skills, thinner skills, Agent Teams rewrite, Tasks API optional, plugin-prefixed agent types. Section below. Follow-ups listed under 1.0.0 |
| 2.0.0 | Released 2026-11-09 | Claude Code plugin, `rig-init` setup and migration, bin entrypoints, Antigravity sync for the plugin layout. Section below |

---

## 2.0.0 (Released 2026-11-09)

Status: **released** after `2.0.0-beta.1` to `beta.3`. Checked live on Linux (Ubuntu 24.04), Windows 11 and macOS 26: install from GitHub, update from the previous beta, the 1.x migration and restore round trip (Windows also with a locked file and `--resume`), `bin/` entrypoints in every shell, and Linux to Windows `rig:remote` (`doctor`, `run`). The live checks left in the table are follow-ups for 2.0.x, not blockers. Release process: [Release Rig](../how-to/release-rig.md).

| Phase | Area | Status | Follow-up live check |
|---|---|---|---|
| 1 | Plugin skeleton: `plugins/rig/`, manifests, `hooks/hooks.json`, validate CI, version bump check | Built | None. Done: Windows Git Bash for `bin/`. Dropped: double-fire with a 1.x project copy (no 1.x users left) |
| 2 | `bin/` entrypoints, runtime copy, remote protocol 2 | Built | Agent phase dispatch to a worker, moved to the 2.1 `rig-remote upgrade` test pass. Done: `doctor` and `run` from Linux to a Windows worker; statusline after a version bump (nine bumps in 2.0.x) |
| 3 | `rig-init`: plan, migrate, resume, restore, permissions, runtime, deps; `/rig:setup`; consent gate | Built | None. Done: hook counts after migration (covered by the round trips and 2.0.x sessions); round trip on Linux and macOS, EBUSY, resume and restore on Windows |
| 4 | Antigravity sync for the plugin layout | Built | Superseded: Antigravity now has plugins, hooks and subagents; `.agent/` is being replaced by a generated Antigravity plugin (plan `261113-1451-antigravity-plugin-port`) |
| 5 | Docs, `release-plugin.cjs`, beta and 2.0.0 tag | Released | None. Done: install and update on Linux, Windows and macOS; macOS round trip |

| Item | Status | Notes |
|---|---|---|
| Claude Code plugin with marketplace `rig-marketplace` | Released | `/plugin marketplace add hoadh/rig`, `/plugin install rig@rig-marketplace`. Claude Code floor 2.1.292 |
| File installer retired | Done | `install-kit-from-local-repo.cjs` prints the steps; `scripts/install-kit/` removed. 1.x on `release/1.x` |
| 1.x migration | Released | `rig-init --plan`, `--migrate`, `--resume`, `--restore`. Journaled, restorable, never deletes. [How-to](../how-to/migrate-from-rig-1x.md) |
| Setup verbs in a terminal | Released | `rig-init --runtime`, `--permissions`, `--deps`. Refused inside Claude Code. `/rig:setup` only previews |
| Plan 1427 installer dedupe and skill packs | Dropped | Obsolete: the plugin has no copies and ships every skill |
| Release tagging and marketplace pin | Done | `scripts/release-plugin.cjs` writes ref and sha per tag; CI (`--check-ref`) checks the pin against the latest tag. Process: [Release Rig](../how-to/release-rig.md) |

2.0.1 (2026-11-10): core rules for subagents in the plugin, agents that preload the skills they name, `rig-init --plan` warnings for kept files; found in the first real 2.0 session and verified live the same day. 2.0.2 (2026-11-10): git-operator exact result lines, code-review fallback for paths outside the repository. 2.0.3 (2026-11-10): agent-team teammates get the team context and their agent definition's context again; verified live. 2.0.4 (2026-11-10): Agent Teams on native features (teammate role skill and team rules from the hook, correct spawn templates, session-scoped team detection, TeammateIdle task gate); verified live in a fresh session. 2.0.5 (2026-11-10): team context after `/resume`, plan-first through the spawn prompt, secret rule no longer asks on `*.json` globs; verified live in a resumed session. 2.0.6 (2026-11-10): the apply consent gate checks the terminal before the process ancestry, so piped and CI runs skip the Windows PowerShell query; verified on Windows inside and outside Claude Code. 2.0.7 (2026-11-11): faster `code-reviewer` (callers pass the test results and spawn a fresh reviewer per round; the reviewer stops re-running suites, polling background jobs and reading files through Bash), and `release-plugin.cjs` refuses an undated CHANGELOG section. 2.0.8 (2026-11-11): statusline item toggles (`/rig:statusline` and `rig-statusline` explain every item and turn any of them on or off, globally or per project). 2.0.9 (2026-11-12): Windows `Get-Process` identity read in `rig-remote` gets 30 s; a clock-dependent statusline test fixed. 2.0.10 (2026-11-13): Rig ships to Antigravity as a generated plugin in `antigravity/rig/` (replaces `.agent/` and `GEMINI.md`; hooks through an adapter, subagents with mapped tools); verified live on agy 1.5.4, see the [Antigravity feature map](../reference/antigravity-feature-map.md). Then 2.0.x fixes as they come (see [Release Rig](../how-to/release-rig.md)). 2.1 follow-ups: `rig-remote upgrade` (below), `--workflow` for implement, `remote status --follow`, a SubagentStop guard (needs Claude Code 2.1.311), plugin `userConfig`, npm dependencies outside the plugin cache, `--migrate` offering `--runtime`, removing the 1.x migration path (`rig-init --migrate`, the 1.x copy notice; no 1.x users left), the secret-file rule checking a glob against the real directory listing (`~/.config/gcloud/*.json` passes since 2.0.5).

---

## Plugin family

After 2.0, Rig grows from one plugin into several, all in the `rig-marketplace` marketplace and this repo. The core plugin keeps the workflow (plan, implement, test, review, docs, remote); domain plugins add agents, skills and checks for one field. Users add the marketplace once and install the plugins they need.

| Plugin | Install | Scope | Status |
|---|---|---|---|
| `rig` | `rig@rig-marketplace` | Core workflow, hooks, `rig-init`, runtime, `rig:remote` | Released (2.0.10) |
| `rig-mobile` | `rig-mobile@rig-marketplace` | Mobile app development: iOS and Android builds, device and simulator testing, store release | Idea |
| `rig-security` | `rig-security@rig-marketplace` | Security review, threat models, dependency and secret audits | Idea |
| `rig-devops` | `rig-devops@rig-marketplace` | CI/CD, infrastructure as code, containers, deployment and runbooks | Idea |

Before the second plugin ships:

| Item | Notes |
|---|---|
| Layout | One directory per plugin under `plugins/`, one entry each in `.claude-plugin/marketplace.json` |
| Shared core | Domain plugins rely on `rig` for hooks, `rig-init`, the runtime and the core rules instead of copying them. Decide how a domain plugin states and checks that dependency |
| Versions and tags | Each plugin has its own version. Move from `v<version>` tags to plugin-scoped tags (`rig--v2.1.0`, `rig-mobile--v0.1.0`, the form `claude plugin tag` creates) |
| Release script and CI | `release-plugin.cjs`, the version bump check and `--check-ref` take a plugin name instead of assuming `rig` |
| Antigravity plugin | One generated Antigravity plugin per Claude plugin in `antigravity/<name>/`, or only for the core. Decide with the plan `261113-1451-antigravity-plugin-port` outcome |
| Docs | Per-plugin install and skill catalog pages; the [release guide](../how-to/release-rig.md) covers more than one plugin |

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

Released with CI green on Ubuntu, Windows and macOS (PR #2). Closed later: the Linux and Windows live smoke (`/rig:plan`, `/rig:implement`) is covered by the 2.0 betas and the live-verified 2.0.x releases; the Windows `rig:remote` loopback flakiness has not recurred in CI (reopen if it does).

## 1.0.0 (Released 2026-10-17)

| Area | What ships | Where |
|------|------------|-------|
| Agents | 14 agent definitions (planner, tester, code-reviewer, docs-maintainer, debugger, and others) | `plugins/rig/agents/` |
| Skills | 33 skills: 29 `/rig:*` slash commands, 4 helpers with `user-invocable: false` | `plugins/rig/skills/`, [catalog](../../guide/SKILLS.md) |
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
| Verification and safety guards (verify-on-stop hook, bash safety hook, push proof, evidence-based debug reports, live verification items) | Done (1.1.0) | Accepted: the guards have run in every session since 1.1.0. Follow-ups: SubagentStop verify for `implementer`, tester verdict parsing, `kill $(pgrep -f)`, Windows `taskkill`. See [how-to](../how-to/configure-verification-and-safety-guards.md) |
| rig:remote: `upgrade` command (2.1) | Planned | `rig-remote upgrade <machine...> \| --all [--check] [--wait]`: over ssh, update the plugin on each worker (`claude plugin marketplace update`, `claude plugin update`), refresh `~/.claude/rig/runtime` without touching settings, then verify version and scripts against the orchestrator. Also prints version drift at `dispatch`/`run` and shows worker versions in `machines`. Until then: [Update the workers](../how-to/run-plan-across-machines.md#9-update-the-workers) by hand |
| rig:remote: `collect` opens a pull request | Not started | Use `/rig:pr` afterwards for now |
| rig:remote: enforce a dedicated worker OS user | Not started | Recommended in v1, not enforced |
| rig:remote: guided worker setup (`register`, `setup`, doctor `fix:` hints) | Done (1.1.0) | Installing Rig, ssh keys and claude login stay manual |
| rig:remote: worker machine-id check, several projects per worker, per-clone busy lock | Done (1.1.0) | Registry `repos` map keyed by origin; `RIG_MACHINE` placement stays manual. Two-project concurrent run verified at unit level only |
| Antigravity: review follow-ups (2.1) | Not started | Low findings left from the 2.0.10 review: the Stop transcript converter pairs tool results by position (a tool without a result step shifts later ones); the guard ignores `run_command`'s `Cwd` argument; the leftover check lets links to unported skills (`remote`, `team`) through; the Antigravity version check counts test helpers as shipped files; the generator reads adapter files from disk, not `git ls-files`. Details: plan `261113-1451-antigravity-plugin-port`, code review report |
| Antigravity: live checks left open (2.1) | Not started | Interactive `force_ask` prompt and tool names in the Antigravity app or IDE (`view_file`, `grep_search`; only the `agy` 1.5.4 CLI was tested); hook precedence when another plugin defines hooks. Listed in the [feature map](../reference/antigravity-feature-map.md#not-verified-yet) |

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

- **Runtime:** Node.js >= 18.0.0 (`package.json` engines; ESLint 10 for `npm run lint` needs 20.19+, see "Node floor for lint" under [Next](#next)), Bash, Python 3 for some skill scripts
- **Host:** Claude Code CLI. Antigravity installs the generated plugin in `antigravity/rig/` (see [feature map](../reference/antigravity-feature-map.md))
- **Dev tooling:** ESLint 10 (devDependencies) for `npm run lint`; tests run with plain Node (`npm test`); CI in `.github/workflows/ci.yml`
- **External services:** GitHub (Actions, tags, PRs via `gh`; the repo is the plugin marketplace), no npm publishing, ssh (rig:remote only)
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
**Last Review:** 2026-11-13
**Next Review:** at the next release
