# Install and Update Rig

Rig 2.x is a Claude Code plugin. Install it from the marketplace inside Claude Code, then run a few setup verbs in a terminal. Coming from Rig 1.x? Read [Migrate from Rig 1.x](./migrate-from-rig-1x.md) first.

First time? Follow [Getting started](../tutorials/getting-started.md) instead.

**Requirements**

- Claude Code **2.1.292 or newer** (`claude --version`). Older versions cannot run `plugin install --marketplace`. `rig-init` warns below this floor.
- Node.js 18 or newer (the `bin/` entrypoints and hooks run on Node).
- Git.
- macOS 10.15+, Ubuntu 20.04+ / Debian 10+, or Windows 10+ (Git for Windows, or WSL).

## Install

1. In Claude Code, add the marketplace and install the plugin:

   ```text
   /plugin marketplace add hoadh/rig
   /plugin install rig@rig-marketplace
   ```

2. Restart Claude Code (or start a new session) so the hooks and `bin/` entrypoints load.

3. Run `/rig:setup`. It previews what Rig would change on this machine and prints the terminal commands for the rest. It never applies anything itself.

4. Apply the groups you need in a terminal, outside Claude Code (see [Setup verbs](#setup-verbs)).

The plugin is per user and works in every project. There is no per-project copy to keep in sync.

### Install a beta

A beta is tagged on a pre-release branch before it reaches `main`. The release pins the marketplace in the commit after the tag, so add the marketplace from that branch (the release script prints the exact command):

```text
/plugin marketplace add hoadh/rig#<release branch>
/plugin install rig@rig-marketplace
```

Do not add it at the tag (`hoadh/rig#v2.0.0-beta.1`): the tagged commit has the unpinned entry, and the install fails with `Subdirectory 'plugins/rig' not found`.

## Setup verbs

`rig-init` is the only command that changes your Claude Code configuration (`~/.claude`). It runs **only in a terminal, outside Claude Code**. Inside a session it refuses and prints the command to run instead. Every verb except `--plan` shows what it will change and asks `y/N`. There is no flag that skips the question.

| Command | When | What it does |
|---|---|---|
| `rig-init --plan` | any time | Read-only preview of every verb below. Also runs inside Claude Code. |
| `rig-init --runtime` | once after install | Copies the statusline and the remote worker to `~/.claude/rig/runtime` and points `statusLine` at it. A statusline you set yourself is kept. The copy also refreshes itself at each session start. |
| `rig-init --permissions` | once | Merges the reviewed `ask`/`deny` rules for secret files and dependency dirs into `~/.claude/settings.json`. Nothing is removed. Plugins cannot ship these rules, so this is the only way they apply. |
| `rig-init --deps` | optional | Runs the skills dependency installer (ffmpeg, ImageMagick, npm and Python packages for media, browser, mcp and markdown-viewer). It asks per step and never uses sudo. Python skills work without it: `rig-python` builds its own venv on first use. |
| `rig-init --migrate` | only if you had Rig 1.x | Moves 1.x files out of the way. See [Migrate from Rig 1.x](./migrate-from-rig-1x.md). |

Run them in the order `--runtime`, `--permissions`, then `--deps` if you want it.

> **Finding `rig-init` in a terminal.** Claude Code puts the plugin's `bin/` on the PATH of its own Bash tool, not on your shell's PATH. So in a terminal, run it through node with its absolute path, `node "<plugin dir>/bin/rig-init" <verb>`. You do not need to find that path yourself: `/rig:setup`, the 1.x migration notice and every `rig-init` refusal print the exact command for your install. The `rig-init` examples in this guide are short for that command.

## What the plugin does without any setup

- Registers the hooks (session context, subagent context, prompt reminders, the Bash safety guard, and the verify-on-stop guard), the skills and the agents.
- Loads the core rules into every session at start (`SessionStart`).
- Exposes the `bin/` commands (`rig-worktree`, `rig-remote`, `rig-python`, and others) to Bash tool calls.

It does **not** set `statusLine` and does **not** add `permissions.ask` rules. Those need the setup verbs above.

## Update

Each release pins the marketplace to its tag, so you keep the version you installed until you update. To update:

1. Refresh the marketplace, then update the plugin, in a terminal (or with `/plugin` in Claude Code):

   ```bash
   claude plugin marketplace update rig-marketplace
   claude plugin update rig@rig-marketplace
   ```

   The first command reads the latest release pin from the marketplace. The second installs the version that pin names. `claude plugin list` shows the installed version.

2. Restart Claude Code. The runtime copy in `~/.claude/rig/runtime` (statusline and remote worker) refreshes at the next session start. It never goes back to an older version.

3. If you used `--deps`, rerun it in a terminal:

   ```bash
   rig-init --deps
   ```

   Skill npm packages install inside the plugin directory. A plugin update replaces that directory, so `--deps` must run again after every update.

4. If you use `rig:remote`, update every worker machine too. Orchestrator and workers must run the same major version (2.x with 2.x). Steps and checks: [Update the workers](./run-plan-across-machines.md#9-update-the-workers).

What stays as it is:

- Settings that `rig-init --runtime` and `rig-init --permissions` wrote. You do not run them again.
- Hook logs and state in the plugin data directory.

Before you update to a new major version (for example 3.0), read its Breaking list in the [CHANGELOG](../../CHANGELOG.md).

## Uninstall

```bash
claude plugin uninstall rig@rig-marketplace
```

Uninstalling removes the plugin only. Files `rig-init` wrote stay until you delete them:

| Left behind | Where | Remove it |
|---|---|---|
| Statusline setting | `statusLine` in `~/.claude/settings.json` | Delete the entry first. Otherwise Claude Code runs a script that no longer exists. |
| Runtime copy and Python venv | `~/.claude/rig/` (`runtime/`, `venv/`) | Delete the directory after the statusline entry |
| Permission rules | `permissions` in `~/.claude/settings.json` | Remove the Rig `Read(...)`/`Edit(...)` rules by hand if you do not want them |
| Migration backups | `~/.claude/rig-backups/` | Keep until you no longer need a restore, then delete |

## Test an unreleased checkout

Load the plugin from a clone for one session, without installing it:

```bash
claude --plugin-dir ./plugins/rig
```

Do not run this alongside the marketplace install of the same plugin.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/rig:setup` is missing | Plugin not installed, or session started before install | Check `/plugin`, restart Claude Code |
| `rig-init` refuses with a message about Claude Code | Apply verbs run only in a terminal | Open a plain terminal and run the command |
| `rig-init` warns the Claude Code version is too old | Floor is 2.1.292 | Update Claude Code, then run again |
| Hooks run twice | A 1.x global copy is still registered | Run `rig-init --plan`, then migrate. See [Migrate from Rig 1.x](./migrate-from-rig-1x.md) |
| Remote worker refuses with a version message | Worker and orchestrator differ in major version | Install the same major version on both. See [Run a plan across machines](./run-plan-across-machines.md) |

## Related

- [Migrate from Rig 1.x](./migrate-from-rig-1x.md)
- [Configure the verification and safety guards](./configure-verification-and-safety-guards.md)
- [Architecture](../explanation/architecture.md), section "Plugin layout"
