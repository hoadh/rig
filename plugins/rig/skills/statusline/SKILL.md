---
name: statusline
description: "Show, explain and customize the Rig statusline: list every item with what it shows, turn any item on or off (globally or per project), preview the result. Use when the user asks what a statusline item means or wants items hidden or shown."
argument-hint: "[--disable <ids> | --enable <ids> | --reset [ids]] [--project]"
metadata:
  author: rig
  version: "1.0.0"
---

# Statusline

`rig-statusline` (plugin `bin/`) does the work; this skill shows the result and asks. Settings live in `statuslineItems` of `~/.claude/.rig.json`, or `<project>/.claude/.rig.json` with `--project` (the project file wins). The mode (`statusline`: full, compact, minimal, none) is a separate key; a hidden item is hidden in every mode.

Project scope: always pass the project dir explicitly, `--project "<session working directory>"` (the dir the session started in, where the statusline looks for `.claude/.rig.json`). The Bash tool's current dir can drift after a `cd`.

## With arguments

Run `rig-statusline <args>` as given (a bare `--project` becomes `--project "<session working directory>"`), then `rig-statusline --preview --project "<session working directory>"` and show both outputs.

## Without arguments

1. Run `rig-statusline --list --json --project "<session working directory>"` (lists what applies in this project). Show one table per row (session, workspace, activity): id, on/off (and `project`/`global` when set there), sample, description. Say which items the current mode does not show (`shownInMode` false while `on`).
2. AskUserQuestion, multi-select, at most 4 options per question: which items to turn off (from the ones that are on), and which to turn back on (from the ones that are off). Group related ids into one option when there are more than 4 (e.g. `cost, duration, tokens`). Ask whether the change is for all projects (default) or this project only.
3. Run `rig-statusline --disable <ids>` / `--enable <ids>`, plus `--project "<session working directory>"` when the user chose this project only. Then `rig-statusline --preview --project "<session working directory>"` and show it.

## Notes

- Changes show at the next statusline refresh; no restart.
- The statusline runs from `~/.claude/rig/runtime/`, refreshed at session start after a plugin update. If items do not hide, the runtime is older than this plugin: start a new session.
- A statusline the user set up without Rig (`statusLine` in settings pointing elsewhere) does not read these settings.
- Never edit `.rig.json` by hand for this; `rig-statusline` keeps the other keys and refuses an unparsable file.
