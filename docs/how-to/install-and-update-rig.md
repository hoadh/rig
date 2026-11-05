# Install and Update Rig

Install the kit from a local clone of this repo, globally or into one project. First time? Follow [Getting started](../tutorials/getting-started.md) instead.

Requirements: [Claude Code](https://code.claude.com/docs/en/setup), Git, Node.js 18+. macOS 10.15+, Ubuntu 20.04+/Debian 10+, or Windows 10+ (WSL 1/2 or Git for Windows). 4GB+ RAM. Contributors running `npm run lint` need Node 20.19+, 22.13+ or 24+, because ESLint 10 requires it.

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

## Install globally or per project, not both

Choose one:

- **Global** (`--global`): every project on this machine uses `~/.claude`.
- **Per project** (`--dir <project>`): only that project gets a copy in its `.claude/`.

Do not install both for the same project. Rules load twice otherwise. If you installed both, remove the copy you do not want by hand; the installer does not remove the other one.

Hooks that both copies register are not run twice: the global copy steps aside for a project hook with the same event and matcher. It runs anyway when the project copy is a symlink to it, the handler has an `if` condition, or the project sets `disableAllHooks`. Rules and `CLAUDE.md` have no such check.

## Update

```bash
cd rig
git pull
node scripts/install-kit-from-local-repo.cjs --global   # or the same --dir command you used
```

Re-install deletes the retired kit files listed in `scripts/install-kit/retired-kit-hooks-and-files-cleanup.cjs` (`RETIRED_KIT_HOOKS`, `RETIRED_KIT_FILES`). In 1.1 that covers:

- Rule files `development-rules.md`, `documentation-management.md`, `orchestration-protocol.md`, `primary-workflow.md` and `team-coordination-rules.md` in `.claude/rules/`. Their content moved to `core-rules.md` and skill references ([rules layout](../explanation/rules-layout.md)).
- Output style files of the retired level set. The level setting is ignored; use the built-in output-style command.
- The retired thinking skill and the Stop notification hook files. Use extended thinking and the built-in `PushNotification` tool instead.

The 1.1.0 removals are summarized in the "Removed" section of `CHANGELOG.md`; the installer list is authoritative.

Rule and output style files are first copied to `<name>.md.bak` in the same folder, so your edits are not lost. A retired hook file stays while a settings file still runs it in a form the installer does not strip. Other files removed from the kit are not deleted from the target; delete them by hand if needed.

## Custom blocked directories

To block your own directories, add `Read(...)` rules to `permissions.deny` in `.claude/settings.json`, for example `"Read(**/tmp-cache/**)"`.
