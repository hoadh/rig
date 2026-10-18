# Worker Setup Guide (stage 1)

Goal: every worker passes `doctor`, then `machines` lists it, so `/rig:plan` can assign phases to it. Run from the project repo on the orchestrator. `R` below = `node .claude/skills/remote/scripts/remote.cjs` (or the `~/.claude/...` copy).

## What the user must do by hand (cannot be automated)

Tell the user up front; `setup` prints the exact command as a `fix:` line when one is missing.

| Item | How |
|---|---|
| Rig on the worker, SAME version | from a Rig checkout on the worker: `node scripts/install-kit-from-local-repo.cjs --global` |
| Key-based ssh | `ssh-copy-id user@host` (Windows admin: `C:\ProgramData\ssh\administrators_authorized_keys`); `ssh -o BatchMode=yes user@host echo ok` must print ok |
| Host key accepted | `ssh user@host` once interactively, verify the fingerprint (Rig uses `StrictHostKeyChecking=yes`) |
| `claude` logged in | `ssh -t user@host claude` then `/login`, or `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN` in the worker user's env (never in the registry) |
| Push rights for `rig/<machine>/*` | worker user's ssh/deploy key with write access to origin |
| Worker id (`RIG_MACHINE`) | set on the worker so it equals the registry id; see [Worker id](#worker-id-rig_machine) |

## Flow

1. **Collect details** with AskUserQuestion (one machine at a time): id (`^[a-z0-9][a-z0-9-]{0,31}$`, = that machine's `RIG_MACHINE` or lowercased hostname), ssh target (`user@host` or `~/.ssh/config` alias), os (`linux`/`macos`/`windows`), absolute clone path for a NEW Rig-only clone (e.g. `/home/rig/<project>`), optional absolute `node`/`claude` paths (required `node` on Windows), optional `allowedTools`. Never ask for or store passwords/tokens.
2. **Register**: `R register <id> --ssh <target> --os <os> --repo <path> [--node <abs>] [--allowed-tools "Bash(npm test:*)"]`. Exit 2 = invalid entry: fix the flag shown and retry; `--replace` only if the user wants to overwrite an existing id. Another project on the same machine: see [Multiple projects on one worker](#multiple-projects-on-one-worker).
3. **Setup**: `R setup <id> [--git-name "Rig <id>" --git-email <email>]`. It runs ssh/node/claude probe → Rig protocol → `machine-id` check → creates the clone + baseline → `doctor`. Idempotent: rerun freely. A `machine-id` failure stops setup before the clone is created.
4. **Fix loop**: for each `FAIL`/`WARN` line, apply its `fix:` (manual items → ask the user to do them and confirm), then rerun `setup <id>`. Stop after 3 identical failures and ask the user.
   - `machine-id` FAIL (`worker id is "x", registry calls it "y"`): set `RIG_MACHINE` on the worker (see [Worker id](#worker-id-rig_machine)), or rename the registry key to `x`. `machine-id` WARN (`predates machine-id report`): update Rig on the worker.
   - `repo` FAIL (`no clone of <origin> on <id>`) in a project: run `R register <id> --repo <abs clone>` in that project, then `setup <id>`.
   - `baseline ... no usable baseline` on an EXISTING clone: ask the user to inspect `<repo>/.git` (config, hooks) first; only after they confirm, rerun with `--accept-existing-clone`. Never add this flag on your own.
   - `git-identity` warn: rerun with `--git-name/--git-email` (sets it in the clone and re-records the baseline).
5. **Verify**: `setup` ends with `setup: ok`; then `R machines` shows the id. Done: continue with `/rig:plan`.

## Worker id (`RIG_MACHINE`)

The worker reports its id (`RIG_MACHINE`, else lowercased hostname) and `setup`/`doctor` compare it with the registry key. The variable must be visible to non-interactive ssh sessions and runners, so set it where those read it:

| Worker OS | Where |
|---|---|
| macOS, zsh | `export RIG_MACHINE=<id>` in `~/.zshenv` |
| Linux, bash | `export RIG_MACHINE=<id>` at the top of `~/.bashrc`, before the interactive guard (`case $- in *i*) ;; *) return;; esac`) |
| Windows | `setx RIG_MACHINE <id>` as the worker user; restart the sshd service if it is not picked up |

Or keep the variable and rename the registry key to the reported id. Check with `R setup <id>`.

## Multiple projects on one worker

One worker OS user can hold a clone per project. Each project needs its own clone path; clones must not nest and must not be another clone's `<path>-rig-test`.

1. In the first project: `R register <id> ...` as usual (writes `repo` and `repos[<origin>]`), then `R setup <id>`.
2. In the second project (cwd = that repo, origin set): `R register <id> --repo <abs clone path for project 2>`, then `R setup <id>`. The entry's other flags must match the stored ones, or use `--replace` only if the user agrees.
3. When `register` first adds a project to a legacy entry, it warns that the other projects must run `register` in their own project, or they get `no-clone` (exit 2).
4. `R machines` in a project marks machines without its clone `(no clone for this project)`; `machines --json` gives `hasClone: false`. Do not assign phases to those machines: `dispatch` and `setup` refuse them with `no-clone`.

Runs of different projects execute in parallel on the worker (one agent and one test run per clone). Details: [registry format, Projects](./registry-format.md#projects-repos).

## Container sandbox

Use this when the worker is a container. The same rules apply: Rig clone, Rig-only user, `setup` as usual.

| Item | Why and how |
|---|---|
| Fixed id | Containers get a new hostname on each recreate. Set `RIG_MACHINE=<id>` in the image or run environment, or pin the hostname (`docker run --hostname <id>`). `RIG_MACHINE` is preferred |
| Persistent home volume | Mount a volume on the worker user's home. It keeps `~/.rig` (run dirs, busy markers, baselines), the clones (`<clone>` and `<clone>-rig-test`) and the claude login (`~/.claude`). Without it, the baseline is lost (`failed:prepare`) and clones are recreated |
| ssh alias with port | The registry has no port field. In the orchestrator's `~/.ssh/config`: `Host <id>` with `HostName`, `Port`, `User`; then `--ssh <id>` in the registry |
| Persistent sshd host keys | Keep `/etc/ssh` host keys on a volume. A new key on each start fails `StrictHostKeyChecking=yes` until the user re-accepts it |
| `claude` token | Pass `CLAUDE_CODE_OAUTH_TOKEN` as a runtime env var or from your secret store. Never put it in the registry, plans, or the image |

Do not give the container user your personal ssh keys or cloud credentials (see the threat model in `docs/how-to/run-plan-across-machines.md`).

## Notes

- `setup` refuses (never overwrites) a non-git dir, a dirty clone, a clone with another origin, or a quarantined clone, and with `--accept-existing-clone` also a clone holding unpushed commits or a stash (runs reset it); a failed clone is removed so a rerun starts fresh; the `fix:` line says what to delete or inspect.
- The worker clones the orchestrator's `origin` with credentials stripped, so the worker needs its own access. Prefer an ssh origin URL (https under Windows headless tasks is unverified).
- After changing global gitconfig on a worker, rerun `R setup <id> --accept-existing-clone` (after inspection) to re-record the baseline.
