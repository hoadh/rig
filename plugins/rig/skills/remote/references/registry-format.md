# Machine Registry Format

File: `~/.claude/rig-machines.json` on the orchestrator (override: `RIG_MACHINES_FILE`). Workers do not need one. Unknown keys are rejected; keys that look like secrets (`token`, `password`, `apiKey`, `credential`) get an explicit error. Never store secrets here.

```json
{ "machines": { "<id>": { ...entry } } }
```

`<id>` is the machine's `RIG_MACHINE` (`^[a-z0-9][a-z0-9-]{0,31}$`: lowercase letters, digits, `-`; no `_`).

Prefer `remote.cjs register <id> --ssh ... --os ... --repo ...` over hand editing: it validates the entry (and the whole existing file) and writes atomically.

## Keys

| Key | Req | Meaning |
|---|---|---|
| `ssh` | yes | `user@host` or an ssh config alias (no option-like values) |
| `os` | yes | `macos` \| `linux` \| `windows` |
| `shell` | yes | `bash` (macos/linux) \| `powershell` \| `cmd` (windows) |
| `repo` | yes | Absolute path of a Rig-dedicated clone on that machine. Serves every project while the entry has no `repos`; with `repos`, used only when the orchestrator's cwd has no origin (see Projects) |
| `repos` | no | `{"<normalized origin>": "<abs clone path>"}`: one Rig clone per project on this machine |
| `pathPrepend` | yes | Absolute dirs prepended to PATH for non-interactive ssh (`[]` if none); only placed in the PATH env var, so spaces are allowed (`;`, quotes and cmd metacharacters are not) |
| `node` | win: yes | Absolute node path. REQUIRED on Windows; recommended elsewhere (non-interactive ssh PATH often lacks node) |
| `claude` | no | Absolute path of the claude binary (default: `claude` on PATH) |
| `allowedTools` | no | Extra tools for agents on this machine (rules below) |
| `taskMode` | win only | `headless` (default) or `interactive` |

## Projects (`repos`)

One machine can hold a dedicated clone per project. The orchestrator picks the clone by the origin of the project it runs in (`git remote get-url origin`, normalized):

| Situation | Clone used |
|---|---|
| `repos` has the cwd origin's key | `repos[key]` |
| No `repos` (legacy entry) | `repo` |
| cwd has no origin | `repo` |
| `repos` exists, cwd origin is not a key | none: exit 2, class `no-clone`, hint to run `register` in that project |

The resolution is strict: once `repos` exists, a project missing from it never falls back to `repo`, so it cannot share another project's clone. Workers never see `repos`: the orchestrator sends the resolved clone as `repo`, so older workers work unchanged.

Keys are normalized origins: lowercase, no scheme, user, credentials or `.git` (`git@github.com:Org/App.git` -> `github.com/org/app`). Clone paths must be absolute, unique, not nested in another clone path, and not equal to another clone's `<path>-rig-test` (Windows paths compare case-insensitively).

### Adding a project

Run `register` inside the project (cwd must have an `origin` remote):

| Command | Result |
|---|---|
| `remote.cjs register <id> --repo <abs clone>` (id exists) | Adds or updates `repos[<cwd origin>]`. Other flags you pass must equal the stored values, else it refuses and points at `--replace` |
| `remote.cjs register <id> --ssh ... --os ... --repo <abs clone>` (new id) | Writes `repo` and `repos[<cwd origin>]` (the key only when cwd has an origin) |
| `... --replace` | Rebuilds the entry from the flags, keeps other projects' `repos`, sets the current project's key |

When the first `repos` key is added to a legacy entry, `register` prints a warning: other projects that used the old `repo` must run `register <id> --repo <that path>` in their own project, or they get `no-clone`. Then run `setup <id>`.

### Removing a project

There is no remove command. Delete the project's key from `repos` by hand, then run `doctor`. The clone on the worker stays until someone deletes it.

### Compatibility

Rig builds without `repos` reject the key (unknown key). To roll back, delete every `repos` key; each entry then uses `repo` again.

## taskMode (Windows)

- `headless` (default): scheduled task with S4U logon. Works with no one logged on. Started immediately with `schtasks /Run` (if `/Run` fails, the 1-minute time trigger starts it instead; `runner.lock` makes a second fire a no-op). Costs: no desktop (no GUI tests), network credentials from Credential Manager under S4U are unverified, so `doctor` warns; use ssh remotes or a token in the service user's environment.
- `interactive`: opt in for GUI work. Needs the user logged on; otherwise runs end `failed:not-started`.

## allowedTools rules

Baseline for every agent: `Read Edit Write Glob Grep` plus `Bash(git add|commit|status|diff|log|show:*)`. Registry entries add scoped test commands, e.g. `Bash(npm test:*)`, `Bash(pytest:*)`. Rejected: bare `Bash`, wildcards, `sed`/`gsed` (GNU sed `e` runs shell), shells and interpreters (`sh bash zsh cmd pwsh powershell node python perl ruby deno bun`), `curl wget ssh scp`, shell metacharacters (`; & | $ < > ( ) \` backslash`), `git push|config|remote`. `git push/config/remote` and any git command with `--output` (`Bash(git * --output*)`: diff/log/show would write a file anywhere) are always disallowed for agents; the worker re-adds this denylist itself and the runner pushes. The `--output` rule matches command text only, so a quoted spelling (`--o''utput=`) is not caught: treat it as a seatbelt, not containment. `dispatch --allowed-tools` can only narrow this set.

## Dedicated clone

`repo` must be a clone used only by Rig: the runner requires a clean tree, resets it, and quarantines it if git config/hooks/info differ from the known-good baseline before, during or after an agent run (`failed:hooks-tampered`; re-clone after inspection and re-baseline). `run` commands execute in a SEPARATE clone `<repo>-rig-test` (plain `--no-local` clone of the same origin; its `.git/config` is rewritten wholesale before each reuse, dropping `insteadOf`/`pushurl`/`credential`/`core` overrides; only layout keys and the `[extensions]` keys objectformat/compatobjectformat/refstorage/worktreeconfig survive, so sha256 origins work; a symlinked `.git`/config makes the run fail `prepare`: delete `<repo>-rig-test` to re-clone), never in a worktree sharing the agent clone's git dir. Its `origin` must be the same remote as the orchestrator's, and the clone needs push credentials for `rig/<machine>/*` branches.

### Known-good baseline (required once per clone)

The hash of the clone's git config/hooks/info, `objects/info/alternates`, AND the user-level git config (`~/.gitconfig`, `~/.config/git/config`, `$XDG_CONFIG_HOME/git/config` when set, plus every file reachable through `path` keys of `[include]`/`[includeIf "..."]` sections, found textually and recursively regardless of the condition (so `hasconfig:`/`onbranch:` targets count and the hash does not depend on HEAD); files are hashed in full; more than 64 extra files fails the run (`prepare`, no quarantine); `~user/` paths hash as an `unresolvable` marker; a missing file counts as a stable marker; the launcher always hands `XDG_CONFIG_HOME` (empty = unset) to the runner so both hash the same set) is stored OUTSIDE the clone (`~/.rig/git-baseline-<hash>.json`). After creating (or re-cloning) and inspecting the dedicated clone, record it on that machine:

`node <skill>/scripts/worker.cjs baseline --repo <clone path>`

Or let the orchestrator do it: `remote.cjs setup <machine>` creates a missing clone (`git clone --no-local` of the orchestrator's origin, credentials stripped) and records the baseline; for an existing clone it records one only with `--accept-existing-clone` (after you inspected it).

This also works over plain ssh with no stdin (`ssh <host> node <skill>/scripts/worker.cjs baseline --repo <clone path>`): an empty non-TTY stdin is treated as a manual run.

**Re-run `baseline` for each clone after intentionally changing global gitconfig** (otherwise runs fail `hooks-tampered`). Until a baseline exists every agent run AND every `run` (test) command fails `failed:prepare`: the test clone reads `origin` from the agent clone, so that clone must pass the gate first; a quarantined clone is refused by the command. The baseline is re-verified after the agent and right before the privileged push. All git run by the runner and by agent children is pinned via `GIT_CONFIG_*` (`core.hooksPath=/dev/null` on Unix; on Windows `~/.rig/empty-hooks`, verified empty on every git call, else `failed:hooks-tampered`; `sshCommand=ssh`, fsmonitor off, no `ext::`); agent children additionally ignore the system gitconfig (`GIT_CONFIG_NOSYSTEM`) except that the system `core.autocrlf` / `core.eol` / `core.safecrlf` (strict value allowlist) are forwarded via `GIT_CONFIG_*` so the agent sees the same line-ending view of the worktree as the runner (Git for Windows ships `autocrlf=true` there), runner git keeps the whole system config so a system credential helper (Git for Windows `manager`, Apple osxkeychain) still works for push; `GIT_SSH_COMMAND`, `GIT_ASKPASS` and `GIT_CONFIG_GLOBAL` never reach the agent.

## Examples

```json
{
  "machines": {
    "studio": { "ssh": "rig@studio.local", "os": "macos", "shell": "bash", "repo": "/Users/rig/work/app",
                "pathPrepend": ["/opt/homebrew/bin"], "node": "/opt/homebrew/bin/node",
                "claude": "/opt/homebrew/bin/claude", "allowedTools": ["Bash(npm test:*)"] },
    "win11":  { "ssh": "rig@win11", "os": "windows", "shell": "powershell", "repo": "C:\\rig\\app",
                "pathPrepend": ["C:\\Program Files\\nodejs"], "node": "C:\\Program Files\\nodejs\\node.exe",
                "taskMode": "headless", "allowedTools": ["Bash(npm test:*)"] },
    "box":    { "ssh": "rig@box", "os": "linux", "shell": "bash", "repo": "/home/rig/app",
                "pathPrepend": ["/usr/local/bin"], "node": "/usr/bin/node", "allowedTools": ["Bash(pytest:*)"] }
  }
}
```

Two projects on one machine (`app` = `github.com/org/app`, `site` = `github.com/org/site`):

```json
{
  "machines": {
    "studio": { "ssh": "rig@studio.local", "os": "macos", "shell": "bash",
                "repo": "/Users/rig/work/app", "pathPrepend": [], "allowedTools": ["Bash(npm test:*)"],
                "repos": { "github.com/org/app": "/Users/rig/work/app",
                           "github.com/org/site": "/Users/rig/work/site" } }
  }
}
```

## Windows executable paths (`node`, `claude`)

They are quoted into a cmd/PowerShell command line. Paths containing any of `( ) & ^ % ! " < > |` are rejected (e.g. `C:\Program Files (x86)\nodejs\node.exe`); use the 8.3 short path (`dir /x` -> `C:\PROGRA~2\nodejs\node.exe`) or install node/claude in a directory without those characters. Plain spaces (`Program Files`) are fine. `cmd`-shell commands for `run`/`exec` may not contain double quotes.
