---
name: setup
description: "Set up Rig after installing the plugin: preview the runtime, permissions and dependencies, then print the terminal commands to apply them. Use after installing or updating Rig."
argument-hint: ""
disable-model-invocation: true
metadata:
  author: rig
  version: "2.1.0"
---

# Rig Setup

Plan only. This skill previews what `rig-init` would change and prints the commands. It never applies anything: applying changes the user's Claude Code configuration, so `rig-init` refuses inside a session and asks y/N in a terminal. Do not try to work around that (no pty tricks, no env changes, no editing settings files directly).

## Step 1: Preview

```bash
rig-init --plan --json
```

If `rig-init` is not found, the plugin's `bin/` is not on PATH yet: tell the user to restart Claude Code, then stop.

In the user's own terminal `rig-init` is not on PATH (Claude Code adds the plugin `bin/` only for its Bash tool). Whenever you print a command for the user to run, write it as `node "${CLAUDE_PLUGIN_ROOT}/bin/rig-init" <verb>` with the absolute path shown here, never a bare `rig-init`.

The JSON has `claudeCode` (version check), `permissions` (`needed`), `runtime` (`installedVersion`, `statusLine`) and `pendingMigrations` (`dir`, `kind`, `root` of each 2.0.x migration that never finished and was not restored).

## Step 2: Show the groups

Summarize in one short block per group that has something to do:

| Group | Command | What it does |
|---|---|---|
| Runtime + statusline | `rig-init --runtime` | Copies the statusline and remote worker to `~/.claude/rig/runtime` and points `statusLine` at it. A statusline you set yourself stays. |
| Permissions | `rig-init --permissions` | Adds ask rules for secrets (`.env`, keys) and deny rules for dependency/build dirs to `~/.claude/settings.json`. Nothing is removed. |
| Dependencies (optional) | `rig-init --deps` | Runs the skills installer: ffmpeg/imagemagick, global npm tools, skill npm deps, Python packages. Asks per step, no sudo. Only needed for media, browser, mcp, markdown-viewer skills; Python skills work without it (`rig-python` builds its own venv). |

Mention, from the plan: a `claudeCode.status` of `old` (needs Claude Code 2.1.292+), and any `pendingMigrations` entry. Rig 2.1 cannot finish those: the user either finishes the migration with Rig 2.0.10 or undoes it with `node <dir>/restore.cjs` (see `docs/how-to/migrate-from-rig-1x.md` in the Rig repo). Rig 1.x files are not supported since 2.1.0; `rig-init` has no migration verbs any more.

If permissions and runtime are already set and nothing is pending, say Rig is set up and stop.

## Step 3: Ask which to apply

Use AskUserQuestion (multi-select) over the groups that apply. Include "Show me the plan details only" so declining is easy.

## Step 4: Print the commands

For the chosen groups, print the exact commands in one code block, with:

- Run them in a terminal OUTSIDE Claude Code. Each shows what changes and asks `[y/N]`.
- After `--runtime`, start a new Claude Code session so the statusline uses the runtime copy.

Then stop. Do not run any `rig-init` verb except `--plan`.
