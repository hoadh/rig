---
name: setup
description: "Set up Rig after installing the plugin: preview the 1.x migration, runtime, permissions and dependencies, then print the terminal commands to apply them. Use after installing Rig or when migrating from Rig 1.x."
argument-hint: ""
disable-model-invocation: true
metadata:
  author: rig
  version: "2.0.0"
---

# Rig Setup

Plan only. This skill previews what `rig-init` would change and prints the commands. It never applies anything: applying changes the user's Claude Code configuration, so `rig-init` refuses inside a session and asks y/N in a terminal. Do not try to work around that (no pty tricks, no env changes, no editing settings files directly).

## Step 1: Preview

```bash
rig-init --plan --json
```

If `rig-init` is not found, the plugin's `bin/` is not on PATH yet: tell the user to restart Claude Code, then stop.

The JSON has `claudeCode` (version check), `targets[]` (a 1.x `global` and/or `project` install: `settings`, `moves`, `kept`, `committed`, `hint`, `blockers`, `pendingBackup`), `permissions` (`needed`), `runtime` (`installedVersion`, `statusLine`).

## Step 2: Show the groups

Summarize in one short block per group that has something to do:

| Group | Command | What it does |
|---|---|---|
| Migrate 1.x | `rig-init --migrate` | Moves 1.x Rig files and hook registrations out of `~/.claude` / the project into `~/.claude/rig-backups/...` (never deleted, restorable). User hooks, skills, settings and `.env` files stay. |
| Runtime + statusline | `rig-init --runtime` | Copies the statusline and remote worker to `~/.claude/rig/runtime` and points `statusLine` at it. A statusline you set yourself stays. |
| Permissions | `rig-init --permissions` | Adds ask rules for secrets (`.env`, keys) and deny rules for dependency/build dirs to `~/.claude/settings.json`. Nothing is removed. |
| Dependencies (optional) | `rig-init --deps` | Runs the skills installer: ffmpeg/imagemagick, global npm tools, skill npm deps, Python packages. Asks per step, no sudo. Only needed for media, browser, mcp, markdown-viewer skills; Python skills work without it (`rig-python` builds its own venv). |

Mention, from the plan: a `claudeCode.status` of `old` (needs Claude Code 2.1.292+), `blockers` (fix first, e.g. an unparsable settings.json), `pendingBackup` (an interrupted migration: use `rig-init --migrate --resume`), a project `hint` (1.x files committed in git: commit the removal, teammates need the plugin), `kept` files (not Rig's, left alone), and how much data moves (`moves.bytes`).

If nothing is detected and permissions/runtime are already set, say Rig is set up and stop.

## Step 3: Ask which to apply

Use AskUserQuestion (multi-select) over the groups that apply. Include "Show me the plan details only" so declining is easy.

## Step 4: Print the commands

For the chosen groups, print the exact commands in this order (migrate first), in one code block, with:

- Run them in a terminal OUTSIDE Claude Code. Each shows what changes and asks `[y/N]`.
- Add `--global` or `--project <dir>` to `--migrate` when only one target should move.
- Before restoring 1.x: disable the plugin (`claude plugin disable rig@rig-marketplace`), then `node <backup-dir>/restore.cjs` (the path is printed by `--migrate`; `rig-init --restore <backup-dir>` does the same).
- After migrating, start a new Claude Code session so the plugin hooks take over.

Then stop. Do not run any `rig-init` verb except `--plan`.
