# Machine Registry Format

File: `~/.claude/rig-machines.json` on the orchestrator (override: `RIG_MACHINES_FILE`). Workers do not need one. Unknown keys are rejected; keys that look like secrets (`token`, `password`, `apiKey`, `credential`) get an explicit error. Never store secrets here.

```json
{ "machines": { "<id>": { ...entry } } }
```

`<id>` is the machine's `RIG_MACHINE` (`^[a-z0-9][a-z0-9-]{0,31}$`: lowercase letters, digits, `-`; no `_`).

## Keys

| Key | Req | Meaning |
|---|---|---|
| `ssh` | yes | `user@host` or an ssh config alias (no option-like values) |
| `os` | yes | `macos` \| `linux` \| `windows` |
| `shell` | yes | `bash` (macos/linux) \| `powershell` \| `cmd` (windows) |
| `repo` | yes | Absolute path of the Rig-dedicated clone on that machine |
| `pathPrepend` | yes | Absolute dirs prepended to PATH for non-interactive ssh (`[]` if none); only placed in the PATH env var, so spaces are allowed (`;`, quotes and cmd metacharacters are not) |
| `node` | win: yes | Absolute node path. REQUIRED on Windows; recommended elsewhere (non-interactive ssh PATH often lacks node) |
| `claude` | no | Absolute path of the claude binary (default: `claude` on PATH) |
| `allowedTools` | no | Extra tools for agents on this machine (rules below) |
| `taskMode` | win only | `headless` (default) or `interactive` |

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

## Windows executable paths (`node`, `claude`)

They are quoted into a cmd/PowerShell command line. Paths containing any of `( ) & ^ % ! " < > |` are rejected (e.g. `C:\Program Files (x86)\nodejs\node.exe`); use the 8.3 short path (`dir /x` -> `C:\PROGRA~2\nodejs\node.exe`) or install node/claude in a directory without those characters. Plain spaces (`Program Files`) are fine. `cmd`-shell commands for `run`/`exec` may not contain double quotes.
