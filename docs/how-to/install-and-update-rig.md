# Install and Update Rig

Install the kit from a local clone of this repo, globally or into one project. First time? Follow [Getting started](../tutorials/getting-started.md) instead.

Requirements: [Claude Code](https://code.claude.com/docs/en/setup), Git, Node.js 18+. macOS 10.15+, Ubuntu 20.04+/Debian 10+, or Windows 10+ (WSL 1/2 or Git for Windows). 4GB+ RAM.

## Install

1. Clone the repo:
   ```bash
   git clone git@github.com:hoadh/rig.git
   cd rig
   ```
2. Preview, then install to the target you want:
   ```bash
   node scripts/install-kit-from-local-repo.cjs --dir ../my-app --dry-run  # preview, writes nothing
   node scripts/install-kit-from-local-repo.cjs --global                   # → ~/.claude (every project)
   node scripts/install-kit-from-local-repo.cjs --dir ../my-app            # → ../my-app/.claude + CLAUDE.md, AGENTS.md
   ```
   From inside a project, run `node ../rig/scripts/install-kit-from-local-repo.cjs` with no flag: it asks global vs. this directory.
3. Add `--install-skills` to also install skill dependencies. Run with `--help` for all options.

## What the installer changes

- `settings.json` is merged: your hooks and keys are kept, kit hooks are added, kit hooks already present get the kit's `async`/`timeout` options, a timestamped backup is written.
- `settings.json` `permissions.ask` and `permissions.deny` are merged rule by rule. Your rules come first, kit rules the file lacks are appended.
- Hooks the kit no longer ships are removed from `settings.json` (only the kit's own command form; your hooks are kept). Retired kit files listed in `scripts/install-kit/retired-kit-hooks-and-files-cleanup.cjs` are deleted.
- `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.mcp.json`, `.rig.json` are only created when missing.

## Global and project install together

Both installs can coexist. A hook that both register runs once, from the project copy: the global copy exits when the project's `.claude/settings.json` or `settings.local.json` registers its own copy of the same hook for the same event and matcher. Hooks registered on only one side still run, and so does the global copy when the project copy is a symlink to it, the handler has an `if` condition, or the project sets `disableAllHooks`. A hook disabled in the project's `.rig.json` does not fall back to the global copy.

## Update

```bash
cd rig
git pull
node scripts/install-kit-from-local-repo.cjs --global   # or the same --dir command you used
```

Re-install deletes the retired kit files listed in `scripts/install-kit/retired-kit-hooks-and-files-cleanup.cjs` (`RETIRED_KIT_HOOKS`, `RETIRED_KIT_FILES`; empty in 1.0.0). Other files removed from the kit are not deleted from the target; delete them by hand if needed.

## Custom blocked directories

To block your own directories, add `Read(...)` rules to `permissions.deny` in `.claude/settings.json`, for example `"Read(**/tmp-cache/**)"`.
