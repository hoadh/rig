# Changelog

## 2.0.1 (unreleased)

Fixes found in the first real session on 2.0.0 (hooks, guards and `bin/` passed; see the live checklist in the plan).

### Fixes

* **Core rules reach subagents.** A plugin's `rules/*.md` is not loaded by Claude Code, and subagents do not inherit the session-start text, so subagents ran without the core rules. `subagent-init` now appends them in a plugin install. `.rig.json` `subagent.injectCoreRules: false` turns it off; a 1.x files install keeps the old default (off).
* **Agents load the skills they name.** Seven agents named a skill they could not load (no `Skill` tool, no preload): `git-operator` (so its commit and push proof lines never applied), `debugger`, `docs-maintainer`, `progress-tracker`, `planner`, `researcher`, `mcp-runner`. Each now preloads its main skill with `skills:`; optional skills (`library-docs`, `media`, `browser`) are read through `rig-skill-dir` when needed. A scan test keeps it that way.
* **`rig-init --plan` warns about kept files.** A kept `CLAUDE.md` that refers to paths the migration moves (a 1.x `CLAUDE.md` lists the 1.x rules files), and a kept skill named like a plugin skill (`rig:<name>`, listed twice by Claude Code). Warnings only; they show in `--plan`, `--plan --json` (`warnings`) and the confirmation prompt.

### Docs

* Rules layout: how core rules reach sessions and subagents in the plugin. Migration guide: the new warnings and the `CLAUDE.md` edit. Guards: `rig-init-destructive-verbs` asks even when a command only mentions an apply verb (on purpose).

## 2.0.0 (2026-11-09)

Rig ships as a Claude Code plugin. Install it from the marketplace instead of copying files. Existing 1.x installs must be migrated. Read the Breaking list and the migration table before you update.

### Breaking

* **Plugin, not a file copy.** Rig is installed with `/plugin marketplace add hoadh/rig` and `/plugin install rig@rig-marketplace`. The file installer is retired: `scripts/install-kit-from-local-repo.cjs` only prints these steps, `scripts/install-kit/` and `npm run kit:install` are gone, and no `.claude/metadata.json` is written. 1.x stays on `release/1.x` (tag `v1.1.0`).
* **Claude Code 2.1.292 or newer** is required. `rig-init` warns below it.
* **1.x copies make hooks run twice.** A plugin copy yields to a 1.x global or project hook registration, and `session-init` asks you to migrate. Run `rig-init --plan`, then `rig-init --migrate` (see the how-to).
* **Settings that a plugin cannot ship** are applied by the user's terminal: `statusLine` through `rig-init --runtime`, and the secret-file `ask` and dependency `deny` rules through `rig-init --permissions`.
* **Hook state and logs** move to `CLAUDE_PLUGIN_DATA` (`logs/hook-log.jsonl`, `state/`). Shared session files stay in the OS temp dir.
* **Remote worker protocol 2.** The worker runs from `~/.claude/rig/runtime/remote/worker.cjs`. Orchestrator and worker must share a major version; a mismatch or an unknown version is refused. Re-run `rig-init --runtime` on each worker.
* **Python venv** for the `rig-python` entrypoint lives at `~/.claude/rig/venv` (plugin) and is built from the skills' `requirements.txt` on first use. A 1.x `skills/.venv` is left in place.
* **Skill names** have no `rig:` prefix in `SKILL.md`; Claude Code adds the namespace. `rig-plan` and `rig-debug` are now `plan` and `debug`.
* **Antigravity output** changes. `.agent/rules/` holds `core-rules.md` and the concept mapping only; `.agent/scripts/` gains `validate-docs`, `docs-diataxis-layout` and `migrate-docs`; `rig-set-active-plan` and `rig-resolve-env` have no `.agent/` form; `GEMINI.md` is generated from the plugin core rules and `CLAUDE.md`. Claude Code-only frontmatter keys are stripped. The sync fails when a Claude Code-only reference survives.
* **Release packaging** (`scripts/prepare-release-assets.cjs`, `scripts/generate-release-manifest.cjs`, the release zip) is removed. `scripts/release-plugin.cjs` tags a release and pins the marketplace entry to the tag and commit.
* **Plan 1427 items are not in 2.0:** installer dedupe and the optional skill packs. Every skill ships in the plugin.

### Migration

| 1.x | 2.x |
|---|---|
| `node scripts/install-kit-from-local-repo.cjs --global` or `--dir <project>` | `/plugin marketplace add hoadh/rig`, `/plugin install rig@rig-marketplace`, then `rig-init --migrate` if 1.x files exist |
| `npm run kit:install` | Removed. Use the plugin install above |
| `~/.claude/skills/*`, `.claude/skills/*` | Plugin skills, `/rig:<name>`. Not copied |
| `.claude/hooks/*.cjs` and their `settings.json` entries | `hooks/hooks.json` in the plugin. `rig-init --migrate` removes the 1.x entries (kept in the backup) |
| `.claude/statusline.cjs` and `statusLine` | `~/.claude/rig/runtime/statusline.cjs` through `rig-init --runtime` |
| `.claude/rules/*.md` | `plugins/rig/rules/core-rules.md`, injected at session start |
| `.claude/metadata.json` | `plugins/rig/.claude-plugin/plugin.json` |
| `skills/rig-plan`, `skills/rig-debug` | Skills `plan` and `debug` (`/rig:plan`, `/rig:debug`) |
| `node .claude/skills/remote/scripts/remote.cjs` | `rig-remote` |
| `.claude/skills/*/scripts/*.py` with `python` | `rig-python <script>` |
| `~/.claude/hooks/.logs/hook-log.jsonl` | `$CLAUDE_PLUGIN_DATA/logs/hook-log.jsonl` |
| `skills/.venv` | `~/.claude/rig/venv`; the old venv stays |
| `.rig.json`, `.env` files, your own hooks, skills and agents | Unchanged. Kept by the migration |
| Rig 1.x, stay on it | Branch `release/1.x`, tag `v1.1.0` |

### Added

* **Plugin** `plugins/rig/` with manifest, `hooks/hooks.json`, 32 skills (new `setup`), 14 agents, and marketplace `rig-marketplace` (`.claude-plugin/marketplace.json`).
* **`bin/` entrypoints** (14): `rig-browser`, `rig-classify-doc`, `rig-init`, `rig-markdown-viewer`, `rig-mcp`, `rig-migrate-docs`, `rig-python`, `rig-remote`, `rig-resolve-env`, `rig-set-active-plan`, `rig-skill-dir`, `rig-ui-search`, `rig-validate-docs`, `rig-worktree`. They run from the Bash tool PATH.
* **`rig-init`**: `--plan [--json]`, `--migrate [--global|--project <dir>]`, `--resume`, `--restore <dir>`, `--permissions`, `--runtime`, `--deps`. Apply verbs run only in a terminal, outside Claude Code, after a `y/N`. Migration is journaled: backups in `~/.claude/rig-backups/` with a standalone `restore.cjs`, interrupted runs resume, and restore never overwrites a file.
* **`/rig:setup`**: previews `rig-init --plan` and prints the terminal commands. It never applies anything.
* **Runtime copy** `~/.claude/rig/runtime/` (statusline, remote worker), refreshed at session start.
* **Guard**: the Bash guard asks before a command runs `rig-init` apply verbs or a backup's `restore.cjs`.
* **CI**: `plugin-validate.yml` runs `claude plugin validate --strict` on the 2.1.292 floor and on latest, and a PR check requires a greater plugin version for changes under `plugins/rig/`.

### Changed

* **Hooks**: `session-init` returns its context as JSON `additionalContext`. In plugin mode it appends `rules/core-rules.md`, capped with the rest of the context at 10,000 characters.
* **Secret-file guard**: the built-in fallback list covers the full `Read(...)` ask list, because a plugin cannot ship `permissions.ask`.
* **Remote**: hints point at `rig-init --runtime`; the worker reports `runtime-incomplete` when its runtime copy has no `VERSION`.

### Fixes since the first beta

* **Restore works when HOME is reached through a symlink.** On macOS (`/tmp` is `/private/tmp`) restore refused its own backup because it compared the recorded real path with the unresolved `$HOME`. It now compares real paths, as `--resume` does. Backups made by a 2.0 beta restore with `rig-init --restore <backup dir>` from 2.0.0.
* **`rig-init --plan` shows an interrupted migration.** After a migration that left a busy file in place (Windows, open statusline), the plan hid the pending backup. It now names it and `--migrate --resume`. Backup paths print with native separators.
* **No Node `DEP0190` warning on Windows** from the Claude Code version check.
* **One version source.** The marketplace entry no longer repeats the plugin version; `plugin.json` is the only one.
* **Beta install command.** `release-plugin.cjs` prints the marketplace add command for the branch that carries the pin.
* **macOS test flake** in the `rig:remote` hung-git test fixed.

### Docs

* [Release Rig](docs/how-to/release-rig.md): the release process step by step.
* [Update](docs/how-to/install-and-update-rig.md#update): `claude plugin update rig@rig-marketplace` is the whole update (it refreshes the marketplace); what stays, what to rerun.
* [Update the workers](docs/how-to/run-plan-across-machines.md#9-update-the-workers): bring `rig:remote` workers to the orchestrator's version and confirm with `doctor`.

### Verified

Installed from GitHub, updated beta to beta, and run through the 1.x migration and restore round trip on Linux (Ubuntu 24.04), Windows 11 (cmd, PowerShell, Git Bash; locked-file migration and resume) and macOS 26. `rig:remote` from Linux to a Windows worker (`doctor`, `run`).

## 1.1.0 (2026-11-06)

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

### Removed

* **skills:** `sequential-thinking` (use extended thinking) and the Stop notification hooks `.claude/hooks/notifications/` (never wired by default; use the built-in `PushNotification` tool). Callers in `fix`, `test`, `brainstorm`, `rig-plan`, agents, installers, CI and docs were updated. The installer deletes the old files on re-install.
* **output styles:** `.claude/output-styles/coding-level-*.md` and the `codingLevel` setting (`.rig.json`, schema, session-init injection). Use the built-in `/output-style` (Explanatory, Learning, custom).
* **team:** stale Agent Teams reference pages that described `TeamCreate`/`TeamDelete`.
* **rules:** `.claude/rules/development-rules.md`, `documentation-management.md`, `orchestration-protocol.md`, `primary-workflow.md` and `team-coordination-rules.md`. Their content moved to `core-rules.md` and skill references (see Changed).
* **agent tools:** `Task` tool references (now the `Agent` tool), `MultiEdit`, `LS`, `BashOutput`, `KillBash` removed from agent and skill instructions.
* **planning:** `hydration-workflow.md`. Plans are no longer copied into tasks at session start; the next session resumes from the unchecked `[ ]` items.
* **settings:** `.rig.json` `codingLevel` is ignored and was removed from the schema.

### Changed (skills)

* **thin wrappers:** `worktree` (standalone repos use `claude --worktree`, `EnterWorktree`, `worktree.baseRef`, `.worktreeinclude`; the script keeps monorepo project selection; example template excludes `.env`), `explore` (built-in Explore agent, Gemini `ext` kept) and `code-review` (built-in `/code-review` plus the red-team pass and `codebase` scans) each keep a SKILL.md of at most 2.5 KB.
* **team:** rewritten for current Agent Teams: no `TeamCreate`/`TeamDelete`, teammates spawned with the Agent tool `name` and `SendMessage`, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, no pinned model.
* **tests:** `removed-features-reference-scan.test.cjs` fails when removed features are referenced again.

### Changed

* **rules layout:** `.claude/rules/core-rules.md` (1,702 bytes, capped at 1,800) is the only always-loaded rules file. Task-specific sections moved to the `implement`, `rig-plan`, `docs`, `team` and `remote` skill references. Map: [rules layout](docs/explanation/rules-layout.md). Static always-loaded text (CLAUDE.md, rules, agent and skill descriptions) fell from 35.1 KB to 9.6 KB.
* **UserPromptSubmit:** the full `## Rig Session` block is injected on the first prompt, when the active plan changes or when the git branch changes. Other prompts get a one-line `Now:` status. Naming uses `{now}`.
* **subagents:** `subagent.injectCoreRules` (`.rig.json`, default `false`) appends `core-rules.md` to every subagent's SubagentStart context. Claude Code already loads `.claude/rules/*.md` into subagents, so enable it only for installs without a rules folder.
* **descriptions:** agent descriptions capped at 300 characters, skill descriptions at 250 (enforced by a budget test).
* **Tasks API:** optional. `progress` reads phase files and reconciles tasks only when `TaskCreate` is available.
* **agents:** `effort` and `skills` (preload) in frontmatter; `git-operator` secret rules; ui skills scoped with `paths:`.
* **rules tone:** always-loaded text (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`) fell from 25.6 KB to 13.2 KB. Emphasis markers (`MANDATORY`, `NON-NEGOTIABLE`, `NO EXCEPTIONS`) are gone; each hard rule states its reason. Tier 1 eval fails if they return. The 500-line limit is a guideline with exemptions for data, generated and test files.
* **primary workflow:** "plan first for everything" is replaced by the size tiers. The main agent does the work; subagents are used for isolation, parallelism or independent review.
* **docs:** install Rig once, globally or per project. Both installs load the rules twice.
* **Antigravity:** `.agent/` and `GEMINI.md` regenerated from the tier and tone rules.
* **git push proof:** `git-operator`, `git` and `pr` report `✓ pushed` only when `HEAD` equals the remote ref after the push, `nothing to commit` on a clean tree, and `✗ push NOT confirmed` otherwise.
* **debug reports:** `debugger` reports separate `## Confirmed` (with evidence) from `## Hypotheses` (with a confirm or rule-out command).
* **rules:** privileged steps are handed over as one runnable block; SSH users resolve through `ssh -G` and production hosts are read-only; only chat replies follow the user's language (`language` setting).
* **rig:remote busy markers:** `agent.busy` and `test.busy` are replaced by `agent-<cloneHash>.busy` and `test-<cloneHash>.busy`. A live legacy marker is still honored; stale files from either version can be deleted.

### Fixes

* **hooks:** plugin-prefixed agent types (`rig:tester`) are normalized to `tester` wherever hooks key on the agent type.
* **hooks:** `subagent.agents.*.contextPrefix` now takes effect in SubagentStart.
* **rig:remote:** the owns-denylist covers `plugins/*/**`, `.claude-plugin`, `hooks.json` and `.worktreeinclude`.
* **line endings:** `.gitattributes` pins LF for `.cjs`, `.mjs` and `bin` files.
* **installer:** retired rule and output-style files are copied to `<name>.md.bak` before removal. A retired hook file stays while a settings file still runs it.
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
* **rig:remote:** a valid `.rig/<dir>` worktree was rejected as "exists but is not a worktree" on Windows when the repo path held an 8.3 short name (`RUNNER~1`). Paths are now compared with `fs.realpathSync.native`.
* **hooks:** the Bash tokenizer resolves an absolute `cd` target the same way as a relative one (native form on Windows).
* **tests:** all node suites pass in CI on Ubuntu, macOS and Windows (first full run: 1 macOS and 11 Windows files failed). Fixes cover tmp-path realpath (`/private/var`, 8.3 names), CRLF checkouts, path separators, a `git.cmd` fake git, and `/tmp` and `/etc/passwd` literals. The `rig:remote` test harness prints full assertion diffs.

### Migration from 1.0.x

| If you | Do |
|--------|----|
| Used `sequential-thinking` | Use extended thinking (built in). |
| Relied on Stop notifications (`hooks/notifications/`) | Use the built-in `PushNotification` tool or your own `Stop` hook. |
| Used a coding level (`codingLevel`, `coding-level-*` styles) | Ignored now. Use the built-in `/output-style` (Explanatory, Learning or custom). |
| Edited a removed rule file | Re-install keeps it as `<name>.md.bak`. Port the edits to `core-rules.md` or the skill reference that now holds the section. |
| Installed Rig globally and into a project | Keep one. Both load the rules twice. Remove the copy you do not want by hand. |
| Run subagents in an install without a rules folder | Set `subagent.injectCoreRules: true` in `.rig.json`. |
| Used `worktree` on a standalone repo | Use native `claude --worktree` or `EnterWorktree`. Monorepo selection still uses the script. `.worktreeinclude` no longer copies `.env` by default; copy `references/worktreeinclude-example` if you need it. |
| Used `/rig:team` with `TeamCreate` | No explicit team step. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and spawn named teammates with the Agent tool. |

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
