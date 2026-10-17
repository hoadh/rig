# Changelog

## 1.0.0 (2026-10-17)

First release of Rig, an Agentic-Driven Development toolkit for Claude Code.

### Features

* **Agents:** 14 subagents in `.claude/agents/` for planning, research, implementation, testing, review, debugging, docs and git. They hand work to each other through files in `plans/` and `plans/reports/`.
* **Skills:** 32 skills in `.claude/skills/`, 27 as `/rig:*` slash commands (`/rig:plan`, `/rig:implement`, `/rig:fix`, `/rig:test`, `/rig:code-review`, `/rig:pr`, `/rig:docs`, ...) and 5 internal helpers (`sequential-thinking`, `problem-solving`, `context-engineering`, `project-organization`, `mermaidjs-v11`).
* **Hooks:** four hooks (`session-init`, `subagent-init`, `team-context-inject`, `dev-rules-reminder`) inject only dynamic facts: datetime, paths, active plan and naming pattern.
* **Native Claude Code features:** sensitive files use `permissions.ask` rules (`Read`/`Edit` of `.env*`, keys, `*.pem`, credentials; `.env.example` allowed), heavy directories use `permissions.deny` (`node_modules`, `.venv`, `__pycache__`, `.next`, `.nuxt`, `coverage`), the statusline reads `rate_limits` from stdin, and file naming is a rule in `.claude/rules/development-rules.md`.
* **Multi-machine orchestration (`rig:remote`):** runs plan phases and test commands on macOS, Windows and Linux workers over ssh, with git as the only data channel. Plan phases can set `machine`, `owns`, `dependsOn`, `reviewedSha` and `reviewScore`. `/rig:plan` reads the machine registry (`~/.claude/rig-machines.json`) and asks which machines to use. See [ADR 0002](docs/explanation/decisions/0002-multi-machine-remote-orchestration.md) and [how-to](docs/how-to/run-plan-across-machines.md).
* **Docs:** Diataxis layout (`docs/`), `/rig:docs` with a `restructure` migrator and a layout-aware validator.
* **UI:** `ui-styling` targets Tailwind CSS v4 (CSS entry file with `@theme`, oklch shadcn/ui theming); `ui-design` ships the style, palette and stack data.
* **create-skill:** description optimizer runs through `claude -p` with the session auth and enforces the 1024-character description limit.
* **Antigravity:** `node scripts/sync-antigravity-agent-dir.cjs` generates `.agent/` and `GEMINI.md` from `.claude/` and `CLAUDE.md`. CI (`antigravity-sync-check.yml`) fails when they drift. `rig:remote` and `rig:team` are Claude Code only.
* **Installer:** `scripts/install-kit-from-local-repo.cjs` installs into a project or `~/.claude`, merges `settings.json` hooks and `permissions`, and removes retired kit files from existing installs.
* **Release:** GitHub Releases with `rig.zip`, built by `scripts/prepare-release-assets.cjs`; `npm test` runs every hook test file.
