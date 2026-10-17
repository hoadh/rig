# Worker Headless Runs: Hooks and Settings

A worker agent is `claude -p` run in the worker's dedicated clone (the registry `repo`; the agent runs in the clone itself, not in a worktree), with an allowlisted environment (no orchestrator secrets) and `--allowedTools`/`--disallowedTools` from the spec. No `--dangerously-skip-permissions`; a permission prompt cannot be answered, so it counts as a denial.

## Which hooks and rules apply

The clone is a checkout of the project, so its `.claude/settings.json` and `.claude/hooks/**` apply, plus the worker user's `~/.claude/` settings:

- Kit `permissions` rules in `.claude/settings.json` apply: `deny` rules (reads of `node_modules`, `.venv`, `coverage`, ...) deny as usual; `ask` rules (sensitive files such as `.env`, `*.pem`) need an answer nobody can give in headless mode, so the access is DENIED. Do not put work in a phase that needs such files; supply values through the worker's own environment or ask the user.
- Session hooks (context injection, status line): run but are harmless.
- Hooks needing tools missing on the worker (python venv, bun) can fail noisily; `doctor` does not check this. Keep project hooks `node`-only or tolerant.

Effect of a denial: the tool call fails, the agent continues or ends with `is_error`; the run still finishes and pushes whatever was committed. Read the report's final section.

## Overriding with --settings

`dispatch ... --settings <abs path>` adds `claude --settings <path>`: a settings file on the WORKER (it is not copied) that layers extra permissions/hooks for that run, for example a worker-local file that disables a hook which cannot work there. The path must be absolute (macOS/Linux or Windows form), is validated, and the file must exist on the worker. It cannot weaken the runner's own guards: `owns` and denylist checks, tamper detection, env allowlist and the `git push/config/remote` and `git ... --output` bans apply regardless (deny rules beat allow rules).

Keep the file out of the repo clone (for example `/Users/rig/.rig-settings/phase.json`) so the clean-tree check passes. Do not put secrets in it.

## Security notes

Threat model: a prompt-injected worker agent is in scope.

- Tool policy (`lib/allowed-tools-policy.cjs`) is a seatbelt, not a sandbox. `Bash(...)` entries are plain command prefixes. Denied: shells, interpreters (including versioned: `python3.12`, `php8.2`), command wrappers, package runners (`npx`, `npm exec|x|create|init`, `pnpm dlx|exec`, `yarn dlx|exec`, `bunx`), `find`, `make`, `awk`, Windows script hosts, and a leading `VAR=value`. git is an allowlist: `add commit status diff log show restore rm mv`; everything else (including bare `git:*`) is rejected.
- `npm test` / `npm run <script>` / `cargo test` / `make`-style entries a registry adds remain arbitrary code execution: the agent can edit `package.json`/`Cargo.toml`/build scripts and then run them. The real controls are the `owns` + denylist guard before push, the env allowlist (no secrets in the agent env) and the orchestrator review gate (`review` before `collect`), not the tool list. Only add such entries to `allowedTools` for machines whose agents you accept running project scripts.
- The owns/denylist guard compares case-insensitively, rejects control characters in paths and protects CI/hook/agent/editor configs (`.github`, `.claude`, `.mcp.json`, `CLAUDE.md` in any dir, `.vscode`, `.cursor`, `.envrc`, `.npmrc`, `.yarnrc*`, ...) unless an `owns` glob explicitly reaches into them.
- `doctor` compares a hash of the worker's skill scripts with the orchestrator's. The hash is reported by the worker itself, so it detects version drift only; it is NOT tamper-proof (a modified worker can report any hash).
- Foreground `exec` runs over the ssh session and dies if ssh drops; use `run --detach` / `dispatch` for anything long.
- ssh runs with `BatchMode=yes` and `StrictHostKeyChecking=yes`: unknown or changed host keys fail closed. Add the host to `known_hosts` first (`ssh <target>` once, interactively). A `StrictHostKeyChecking accept-new` in your ssh config is overridden by this on purpose.
- Residual same-user risks the baseline hash does NOT cover (an agent or its test code runs as the same OS user): `~/.ssh/config` (ProxyCommand, IdentityAgent), shell rc files, PATH shims/`~/bin` wrappers for `git`/`ssh`, and git config reached only through `GIT_CONFIG_GLOBAL`-style env. Treat a worker machine as trusted only to the degree you trust the agent's edits to those files; do not run agents there with a user that holds more credentials than the push needs.
- Cancel safety: `agent.pid` records the leader's start identity (`ps lstart`, `TZ=UTC LC_ALL=C`). A live leader with a different identity is never killed (recycled pid). A dead leader, or a record without identity (ps lacking `lstart`, e.g. busybox), falls back to "the process group still exists" (a pgid cannot be reused while its group lives) and the record must be newer than the last boot; the kill is logged to stderr. win32 has no start-time check.
- `npm|pnpm|yarn` entries with an option before the subcommand are rejected unless the option is in the known boolean/value-taking sets (`npm --otp 1 exec` could hide the subcommand); write the subcommand first.
