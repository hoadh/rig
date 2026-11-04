# Changelog

## Unreleased

### Features

* **CI:** `.github/workflows/ci.yml` runs on push and pull request to `main`: `npm run lint`, `npm test` on Ubuntu, Windows and macOS, eval tier 1 (`bun scripts/eval/run.ts 1`), and pytest for the four Python skill suites. `npm test` discovers every `*.test.cjs` and `*.test.js` under `.claude/` and `scripts/`, prints passed, failed and skipped counts, and lists each skipped file with its reason.
* **lint:** `npm run lint` runs ESLint 10 with a flat config (`eslint.config.mjs`). It was a placeholder that always passed. Lint fixes in hooks, scripts and skills change no behavior.
* **hooks:** `bash-safety-guard` asks before a Bash command reads or copies a secret file (the `Read(...)` ask list in `settings.json`: `.env*`, keys, credentials). Templates such as `.env.example` pass. Ask only, never deny. Switch: `bashSafetyGuard.rules.secretFileRead` in the global `.rig.json`. Limits: [how-to](docs/how-to/configure-verification-and-safety-guards.md).
* **rules:** workflow size tiers (trivial, standard, large) in `primary-workflow.md`, decided in [ADR 0003](docs/explanation/decisions/0003-workflow-size-tiers.md). Trivial work runs without subagents.
* **benchmark:** `scripts/benchmark/` harness (`npm run bench`, `bench:verify`, `bench:report`) compares Claude Code with and without Rig on six fixed tasks, judged by hidden tests. No results published yet.
* **rig:remote worker setup:** `remote.cjs register <id> --ssh --os --repo ...` adds one validated registry entry (atomic write, secret keys rejected). `remote.cjs setup <id...>` prepares stage 1 on each worker: ssh/node/claude probe, Rig protocol check, creation of the dedicated clone from the orchestrator's origin (credentials stripped), baseline recording (`--accept-existing-clone` for clones made by hand) and git identity (`--git-name/--git-email`), then `doctor`. New worker command `prepare`. Guided flow in `references/worker-setup-guide.md`.
* **rig:remote doctor:** new `baseline` check (missing, mismatched or quarantined clone), and a `fix:` line with a concrete next step under every failed or warned check.
* **rig:remote machine-id check:** `info` reports the worker's `machine`. `setup` and `doctor` check `machine-id`: a mismatch with the registry id fails and stops setup before the clone is created; an older worker without the field warns. The `fix:` line shows how to set `RIG_MACHINE` (`~/.zshenv`, `~/.bashrc`, `setx`) or rename the registry key.
* **rig:remote several projects per machine:** the registry takes an optional `repos` map (`{"<normalized origin>": "<clone path>"}`), so one machine holds a clone per project. `register <id> --repo <p>` run in a project adds its clone. A project missing from an existing map fails with `no-clone` (exit 2) and a `register` hint. `machines --json` reports `hasClone`; `doctor` flags a project without a clone. Rig builds without this change reject `repos`: delete the key to roll back.
* **rig:remote per-clone lock:** one agent run and one test run per clone (was per machine), so two projects on one worker run in parallel. A second run on the same clone is refused `busy`.

* **hooks:** `verify-completion-guard` (Stop). When code was edited and no passing test, build, typecheck or lint command ran after the last edit, it nudges (`verifyGuard.mode: remind`, default) or blocks (`block`, max 2 per turn, `Verification skipped: <reason>` line lets through). Off in headless runs and for `rig:remote` agents (`RIG_VERIFY_GUARD_MODE=off`). A project may only raise the mode; `extraCommandPatterns` and the hook toggle are global only.
* **hooks:** `bash-safety-guard` (PreToolUse, `Bash`). Denies or asks on `sed -i`/`perl -i` of a symlink and on risky `pkill` (self-matching `-f`, broad kills, common names). Per-rule switches `bashSafetyGuard.rules.*` and `hooks.bash-safety-guard` are read from the global `.rig.json` only.
* **plans:** optional `## Pending Live Verification` section (`LIVE:` / `LIVE(blocking):` items). A phase with open items stays `In Progress`; evidence is recorded as a pointer. `/loop` template in the new how-to.
* **docs:** how-tos for the guards and for the response language.

### Changed

* **rules tone:** always-loaded text (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`) fell from 25.6 KB to 13.2 KB. Emphasis markers (`MANDATORY`, `NON-NEGOTIABLE`, `NO EXCEPTIONS`) are gone; each hard rule states its reason. Tier 1 eval fails if they return. The 500-line limit is a guideline with exemptions for data, generated and test files.
* **primary workflow:** "plan first for everything" is replaced by the size tiers. The main agent does the work; subagents are used for isolation, parallelism or independent review.
* **docs:** install Rig once, globally or per project. Both installs load the rules twice.
* **Antigravity:** `.agent/` and `GEMINI.md` regenerated from the tier and tone rules.
* **git push proof:** `git-operator`, `git` and `pr` report `✓ pushed` only when `HEAD` equals the remote ref after the push, `nothing to commit` on a clean tree, and `✗ push NOT confirmed` otherwise.
* **debug reports:** `debugger` reports separate `## Confirmed` (with evidence) from `## Hypotheses` (with a confirm or rule-out command).
* **rules:** privileged steps are handed over as one runnable block; SSH users resolve through `ssh -G` and production hosts are read-only; only chat replies follow the user's language (`language` setting).
* **rig:remote busy markers:** `agent.busy` and `test.busy` are replaced by `agent-<cloneHash>.busy` and `test-<cloneHash>.busy`. A live legacy marker is still honored; stale files from either version can be deleted.

### Fixes

* **rig:remote:** `stripUrlCredentials` no longer leaks the tail of a password that contains a raw `@` (`https://u:p@ss@host`), and keeps the user of `ssh://user:pw@host` (drops only the password).
* **hooks:** `RIG_REPORTS_PATH` and `RIG_PLANS_PATH` were double-rooted when a session plan or an absolute `paths.plans` was used, on all platforms. `RIG_REPORTS_PATH` no longer has a trailing separator.
* **hooks:** false "Subdirectory mode" banner on Windows (paths are compared case-insensitively there).
* **hooks:** `subagent-init` double-rooted absolute `paths.plans` and `paths.docs`.
* **rig:remote:** on win32 the agent is killed only when its pid identity (process StartTime) matches the recorded one. If the identity cannot be read, the guard refuses to kill.
* **rig:remote:** the supervisor no longer runs `taskkill` on an exited child's pid, which Windows may already have reused.
* **installer:** retired hooks and files (`scout-block`, `privacy-block`, `descriptive-name`, ...) are now removed from existing installs.
* **skills:** markdown-viewer PID files live in `os.tmpdir()` on Windows. `shadcn_add` finds `npx.cmd`, validates component names and accepts `@scope/name`. `create-skill` `run_eval` works on Windows and sends the query via stdin, which closes a cmd.exe injection through `claude.CMD`. UTF-8 output on piped stdout.
* **install:** `install.sh` on Windows redirects to `install.ps1`. The kit installer's `--install-skills` runs `install.ps1` on win32.
* **line endings:** `.gitattributes` pins LF for `*.sh` and `ui-design` data. This fixes `validate_data.py` on Windows clones.
* **docs:** agent and skill instructions give Windows-safe commands.
* **tests:** hook and remote suites pass on Windows.

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
