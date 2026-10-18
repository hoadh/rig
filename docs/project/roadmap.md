# Rig - Project Roadmap

**Last Updated:** 2026-10-18
**Current Version:** 1.0.0
**Repository:** https://github.com/hoadh/rig

Version history lives in [CHANGELOG.md](../../CHANGELOG.md). This roadmap tracks status and plans only.

## Executive Summary

Rig is an orchestration framework for Claude Code: agents, skills, hooks and workflows that plan, build, test and review software with file-based state. 1.0.0 is released. Next work closes the security and CI gaps and the `rig:remote` follow-ups.

## Status at a Glance

| Milestone | Status | Notes |
|-------|--------|-------|
| 1.0.0 | Released (2026-10-17) | Agents, skills, hooks, docs workflow, rig:remote v1, Antigravity copy |
| Next | Not started | Bash secret guard, real lint step, rig:remote follow-ups |

---

## 1.0.0 (Released 2026-10-17)

| Area | What ships | Where |
|------|------------|-------|
| Agents | 14 agent definitions (planner, tester, code-reviewer, docs-maintainer, debugger, and others) | `.claude/agents/` |
| Skills | 32 skills: 27 `/rig:*` slash commands, 5 helpers with `user-invocable: false` | `.claude/skills/`, [catalog](../../guide/SKILLS.md) |
| Hooks | `session-init`, `subagent-init`, `team-context-inject`, `dev-rules-reminder` inject dynamic facts only | `.claude/hooks/` |
| Native guards | Sensitive files: `permissions.ask`. Heavy directories: `permissions.deny`. File naming: rule in `.claude/rules/development-rules.md`. Usage: statusline reads `rate_limits` from stdin | `.claude/settings.json`, `.claude/statusline.cjs` |
| Statusline | Cross-platform Node.js script with tests; modern 256-color layout: context, 5h/7d limits, time/tokens, git state, config, tools/agents/todos | `.claude/statusline.cjs`, `.claude/hooks/lib/__tests__/` |
| Docs workflow | Diataxis layout; `/rig:docs restructure` (alias `refactor`) migrates non-standard layouts; layout-aware validator | `docs/README.md`, `/rig:docs` |
| UI skills | ui-styling targets Tailwind CSS v4; ui-design ships style, palette and stack data | `.claude/skills/ui-styling/`, `.claude/skills/ui-design/` |
| create-skill | Description optimizer runs via `claude -p` with the session auth | `.claude/skills/create-skill/` |
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
| Bash guard for secret files | Not started | The `permissions.ask` rules cover the `Read`/`Edit` tools only, so a Bash command like `cat .env` is not caught. Add a check for Bash commands that read `.env`, keys and credentials |
| Real lint step in CI | Not started | `npm run lint` is a placeholder that always passes |
| rig:remote: worker auth after a Windows reboot | Not started | Only logoff was verified |
| rig:remote: `doctor` between two workers | Not started | No worker-to-worker keys by design |
| rig:remote: per-argument PreToolUse guard | Deferred | Low priority; see ADR 0002 threat model |
| rig:remote: `collect` opens a pull request | Not started | Use `/rig:pr` afterwards for now |
| rig:remote: enforce a dedicated worker OS user | Not started | Recommended in v1, not enforced |
| rig:remote: guided worker setup (`register`, `setup`, doctor `fix:` hints) | Done (Unreleased) | Installing Rig, ssh keys and claude login stay manual |
| rig:remote: worker machine-id check, several projects per worker, per-clone busy lock | Done (Unreleased) | Registry `repos` map keyed by origin; `RIG_MACHINE` placement stays manual. Two-project concurrent run verified at unit level only |

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
- **Dev tooling:** no npm dependencies; tests run with plain Node (`npm test`)
- **External services:** GitHub (Actions, releases, PRs via `gh`), no npm publishing (releases are GitHub Releases with `rig.zip`), ssh (rig:remote only), Telegram, Discord or Slack webhook (notifications hook, optional)
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
