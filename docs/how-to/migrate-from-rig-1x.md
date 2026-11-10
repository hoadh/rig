# Migrate from Rig 1.x

Rig 1.x copied its files into `~/.claude` and into projects (`.claude/`). Rig 2.x is a plugin, so those copies must move out of the way, or every hook runs twice. `rig-init --migrate` does that: it moves the 1.x files into a backup, rewrites the hook registrations, and leaves everything else alone. Nothing is deleted, and `rig-init --restore` puts it back.

Read [Install and update Rig](./install-and-update-rig.md) for the plugin itself. Want to stay on 1.x? Skip this page and see [Stay on Rig 1.x](#stay-on-rig-1x).

## Before you start

- Install the plugin and confirm Claude Code is 2.1.292 or newer. Do the migration **after** the plugin is installed: session context and the migration notice come from the plugin.
- Close other Claude Code sessions that use the project or `~/.claude`. Open sessions can hold files (on Windows an open statusline locks them).
- Commit or stash your work in a team project (see [Team projects](#team-projects)).

## Steps

### 1. Preview (read-only)

```bash
rig-init --plan          # human-readable
rig-init --plan --json   # what /rig:setup reads
```

`--plan` changes nothing and also runs inside Claude Code. It lists, per target (`~/.claude` and each project):

| Field | Meaning |
|---|---|
| Settings removals | 1.x hook handlers and `statusLine` entries that will be removed from `settings.json` |
| Moves | Files and directories that go into the backup, with count and bytes |
| Kept | Your files that are not Rig's (your hooks, skills, agents, `.env`, `.rig.json`), left in place |
| Committed | How many moved files are tracked by git |
| Blockers | Problems to fix first (see the table below). The migration refuses while any blocker is open. |
| Warnings | Kept files that will misbehave after the move: a `CLAUDE.md` that refers to moved paths (a 1.x `CLAUDE.md` lists the 1.x rules files), and a kept skill named like a plugin skill (`rig:<name>`; Claude Code would list both). Warnings never block |

If the plan finds no 1.x files, there is nothing to migrate.

### 2. Migrate

```bash
rig-init --migrate                  # ~/.claude and the project at the current directory
rig-init --migrate --global         # only ~/.claude
rig-init --migrate --project <dir>  # only one project
```

Run it in a terminal, outside Claude Code. It prints the plan and asks `y/N`. On `y` it:

1. Writes a backup to `~/.claude/rig-backups/<project-hash or global>/<timestamp>/`. The directory is created with owner-only permissions and holds `restore.cjs`, `README.txt`, `journal.json`, `moved-paths.txt` and a copy of each `settings.json` it changed.
2. Rewrites `settings.json` to drop the 1.x hook handlers and `statusLine`. Your other keys stay.
3. Moves the 1.x files into the backup. A project backup is never inside a repository.

Exit codes: `0` done, `1` error, `2` refused (not a terminal, or inside Claude Code), `3` incomplete (see resume).

Afterwards, in a terminal:

```bash
rig-init --runtime       # the migration removes the 1.x statusLine; this sets the new one
rig-init --permissions   # secret-file ask rules and dependency deny rules
```

If `--plan` warned about your `CLAUDE.md`, edit it now: remove the lines that point at the moved 1.x rules files (the plugin injects its core rules into every session and subagent) and keep your own preferences. The old files stay readable in the backup. If it warned about a kept skill named like a plugin skill, delete that skill directory when it is an old Rig copy.

### 3. Resume an interrupted migration

If the migration stops (exit `3`, a crash, a power cut), the journal stays open. Nothing is lost. Close the sessions that hold the listed paths, then:

```bash
rig-init --migrate --resume
```

Resume reads the journal, finishes the moves and settings edits that are still pending, and leaves finished steps alone. Running `rig-init --migrate` without `--resume` while a journal is open refuses (exit `1`) and points to `--resume`.

### 4. Restore (undo)

Restore needs the Rig plugin **disabled** first, or the 1.x hooks would run next to it:

```bash
claude plugin disable rig@rig-marketplace   # add --scope project for a project install
rig-init --restore ~/.claude/rig-backups/<hash-or-global>/<timestamp>
```

`--restore` (or `node <backup-dir>/restore.cjs`, which works without the plugin) puts the files back and re-adds only the hook handlers and `statusLine` it removed. Edits you made after the migration are kept:

- It never overwrites an existing file. A file that now exists stays in the backup as a conflict.
- A hook you deliberately removed after the migration is not brought back.
- Restore can run more than once.

Then re-enable the plugin with `claude plugin enable rig@rig-marketplace`.

## Blockers

`--plan` reports these. Fix the cause and run `--plan` again. The migration re-checks them before it moves anything.

| Blocker | Fix |
|---|---|
| `.claude` or one of its Rig directories is a symlink or junction | Replace the link with a real directory, or move it by hand. rig-init never follows links. |
| `settings.json` does not parse | Fix the JSON. rig-init never rewrites a file it cannot read. |
| A file you keep (a hook, a script, an MCP server, an env value, `mcpServers` in `~/.claude.json`) still runs or reads a path the migration moves | Remove or repoint that reference, then plan again. Otherwise the leftover hook would fail on every event. |
| The directory has no Rig 1.x identity marker | rig-init says the files look like another kit's files and refuses to apply. Check that it is really Rig 1.x. |
| An earlier migration is interrupted | `rig-init --migrate --resume` |
| A path is in use | Close the session that uses it, then `--resume`. Exit `3`. |

## Team projects

A project whose `.claude/` is committed to git (1.x copied it into the repo) has tracked 1.x files. `--plan` counts them under **Committed** and prints a note.

1. Run the migration on your machine.
2. Commit the removal (the deleted files and the edited `settings.json`) on a branch and merge it as any change. rig-init never commits.
3. Teammates pull that commit. A teammate who does not install the Rig plugin gets a project with no Rig hooks, skills or agents. Install the plugin on each machine (see [Install and update Rig](./install-and-update-rig.md)).

Nothing is committed for you. Review the diff: your own files in `.claude/` (hooks, skills, agents) stay and are listed as kept.

## Stay on Rig 1.x

1.x is not deleted. Its last release is tag `v1.1.0` on branch `release/1.x`, and that branch keeps the file installer:

```bash
git clone --branch release/1.x https://github.com/hoadh/rig.git
cd rig && node scripts/install-kit-from-local-repo.cjs --dir ../my-app   # or --global
```

Do not install the 2.x plugin in the same project or `~/.claude` while you stay on 1.x. The two would both run the hooks.

## What 2.x does not carry over

- The 1.x file installer's copy and deduplication logic and the optional skill packs (plan 1427). In 2.x every skill ships in the plugin.
- The 1.x `scripts/install-kit/` installer. `scripts/install-kit-from-local-repo.cjs` on `main` now only prints the steps above.

Full list: [CHANGELOG](../../CHANGELOG.md), `2.0.0`, "Breaking".

## Related

- [Install and update Rig](./install-and-update-rig.md)
- [Architecture](../explanation/architecture.md), section "Plugin layout"
