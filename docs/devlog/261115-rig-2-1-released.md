# Rig 2.1.0 Released

**Date**: 2026-11-15 16:45
**Severity**: Medium
**Component**: rig-init, hooks, rig:remote, Antigravity adapter, release
**Status**: Released in 2.1.0 (PRs #35 to #40, tag `v2.1.0`, GitHub Release Latest). Every verify step passed. The checks in the Antigravity app and IDE are partly open.

## What Happened

Two plans shipped together:
- **Plan 261113-1835** removed the 1.x migration path, fixed the five Low findings from the Antigravity port review, and probed hook precedence live.
- **Plan 261109-1624** added `rig-remote upgrade`.

A red team (15 findings, all applied) and a validation interview came before any code. Each pull request raised a `2.1.0-beta.N` version, because CI wants a greater version on every plugin change. Workers were tested on public beta tags. beta.3 failed the remote live check, so beta.4 was cut with the fix before 2.1.0 was tagged.

## Impact

- **Breaking:** `rig-init --migrate`, `--resume` and `--restore` exit `2`. Migration from 1.x lives on in Rig 2.0.10 on the permanent `release/2.0.x` branch. Leftover 1.x hooks now run next to the plugin, and session start shows a one-line warning.
- **`rig-remote upgrade <machine...> | --all [--check] [--wait]`** updates the plugin on each worker over ssh and refreshes the runtime copy without touching settings. It then checks the version and scripts hash against the orchestrator. `machines` shows each worker's Rig version. `dispatch`, `run` and `collect` print version drift.
- **Antigravity fixes:**
  - Tool results pair with calls per model step and fail closed.
  - `run_command` `Cwd` is honored, and an unresolvable one asks.
  - Links to unported skills become notes.
  - The version check and generator inputs were tightened.
- **Antigravity residual risk, documented:** a workspace `.agents/hooks.json` `overwrite` is applied after Rig's guard and runs without another prompt.

## Technical Details

- **Windows OpenSSH (beta.3 bug):** it keeps a leading quoted executable intact. Wrapping a cmd line in one more pair of quotes, on the assumption that `cmd /c` strips them, broke the refresh step on a Windows worker. The plugin had updated, but the runtime stayed old. No unit test could catch this. A five-line ssh probe on the worker found it.
- **`claude plugin marketplace remove`** uninstalls the plugin and deletes its data. To point an installed worker at a beta, set `ref` in **both** `settings.json` (`extraKnownMarketplaces`) and `plugins/known_marketplaces.json`. Editing only one makes Claude Code lose the marketplace.
- **`claude plugin list --json --available`** (Claude Code 2.1.325) leaves out installed plugins, so `--check` cannot show the marketplace pin of an installed rig.
- **Antigravity precedence (agy 1.5.8, headless):** Rig's `force_ask` wins over another plugin's `allow` or `permissionOverrides`, in either install order. Plugin `overwrite`s run before Rig decides. Workspace hook `overwrite`s run after it.
- **A quarantined worker clone** (`hooks-tampered`) was caused by a later edit to the user-level `~/.gitconfig`, which is part of the baseline hash. Fix: re-clone with `remote setup` and record a new baseline.

## Lessons Learned

- Run the remote live check on a beta before tagging. It found the only real bug of the release.
- A "simple" 1.x leftover on a worker (hooks still in `settings.json`) made the plugin yield and never create a runtime. Check what a worker actually runs before testing on it.
- A detached `run` can fail at prepare in milliseconds. Check that the run is `running` before testing busy handling, or the test proves nothing.
- Probe with throwaway HOMEs for Claude Code and agy. The real configs stayed untouched through every install and remove probe.

## Next Steps

- Antigravity app or IDE: the interactive `force_ask` dialog on reading `.env`, the app's search tool, and other plugins' `allow` in the dialog. Headless already covered search and subagent tools.
- Then archive plan 261113-1835.
