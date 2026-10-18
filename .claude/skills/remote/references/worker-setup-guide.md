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

## Flow

1. **Collect details** with AskUserQuestion (one machine at a time): id (`^[a-z0-9][a-z0-9-]{0,31}$`, = that machine's `RIG_MACHINE` or lowercased hostname), ssh target (`user@host` or `~/.ssh/config` alias), os (`linux`/`macos`/`windows`), absolute clone path for a NEW Rig-only clone (e.g. `/home/rig/<project>`), optional absolute `node`/`claude` paths (required `node` on Windows), optional `allowedTools`. Never ask for or store passwords/tokens.
2. **Register**: `R register <id> --ssh <target> --os <os> --repo <path> [--node <abs>] [--allowed-tools "Bash(npm test:*)"]`. Exit 2 = invalid entry: fix the flag shown and retry; `--replace` only if the user wants to overwrite an existing id.
3. **Setup**: `R setup <id> [--git-name "Rig <id>" --git-email <email>]`. It runs ssh/node/claude probe → Rig protocol → creates the clone + baseline → `doctor`. Idempotent: rerun freely.
4. **Fix loop**: for each `FAIL`/`WARN` line, apply its `fix:` (manual items → ask the user to do them and confirm), then rerun `setup <id>`. Stop after 3 identical failures and ask the user.
   - `baseline ... no usable baseline` on an EXISTING clone: ask the user to inspect `<repo>/.git` (config, hooks) first; only after they confirm, rerun with `--accept-existing-clone`. Never add this flag on your own.
   - `git-identity` warn: rerun with `--git-name/--git-email` (sets it in the clone and re-records the baseline).
5. **Verify**: `setup` ends with `setup: ok`; then `R machines` shows the id. Done: continue with `/rig:plan`.

## Notes

- `setup` refuses (never overwrites) a non-git dir, a dirty clone, a clone with another origin, or a quarantined clone, and with `--accept-existing-clone` also a clone holding unpushed commits or a stash (runs reset it); a failed clone is removed so a rerun starts fresh; the `fix:` line says what to delete or inspect.
- The worker clones the orchestrator's `origin` with credentials stripped, so the worker needs its own access. Prefer an ssh origin URL (https under Windows headless tasks is unverified).
- After changing global gitconfig on a worker, rerun `R setup <id> --accept-existing-clone` (after inspection) to re-record the baseline.
