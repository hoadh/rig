# Changelog

## Unreleased

### Features

* **rig:remote worker setup:** `remote.cjs register <id> --ssh --os --repo ...` adds one validated registry entry (atomic write, secret keys rejected). `remote.cjs setup <id...>` prepares stage 1 on each worker: ssh/node/claude probe, Rig protocol check, creation of the dedicated clone from the orchestrator's origin (credentials stripped), baseline recording (`--accept-existing-clone` for clones made by hand) and git identity (`--git-name/--git-email`), then `doctor`. New worker command `prepare`. Guided flow in `references/worker-setup-guide.md`.
* **rig:remote doctor:** new `baseline` check (missing, mismatched or quarantined clone), and a `fix:` line with a concrete next step under every failed or warned check.
* **rig:remote machine-id check:** `info` reports the worker's `machine`. `setup` and `doctor` check `machine-id`: a mismatch with the registry id fails and stops setup before the clone is created; an older worker without the field warns. The `fix:` line shows how to set `RIG_MACHINE` (`~/.zshenv`, `~/.bashrc`, `setx`) or rename the registry key.
* **rig:remote several projects per machine:** the registry takes an optional `repos` map (`{"<normalized origin>": "<clone path>"}`), so one machine holds a clone per project. `register <id> --repo <p>` run in a project adds its clone. A project missing from an existing map fails with `no-clone` (exit 2) and a `register` hint. `machines --json` reports `hasClone`; `doctor` flags a project without a clone. Rig builds without this change reject `repos`: delete the key to roll back.
* **rig:remote per-clone lock:** one agent run and one test run per clone (was per machine), so two projects on one worker run in parallel. A second run on the same clone is refused `busy`.

### Changed

* **rig:remote busy markers:** `agent.busy` and `test.busy` are replaced by `agent-<cloneHash>.busy` and `test-<cloneHash>.busy`. A live legacy marker is still honored; stale files from either version can be deleted.

### Fixes

* **rig:remote:** `stripUrlCredentials` no longer leaks the tail of a password that contains a raw `@` (`https://u:p@ss@host`), and keeps the user of `ssh://user:pw@host` (drops only the password).

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
