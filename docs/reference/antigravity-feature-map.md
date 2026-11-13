# Antigravity feature map

**Last Updated:** 2026-11-13
**Verified with:** `agy` 1.5.4, plugin `rig` 2.0.10-agy.1 installed from a local `antigravity/rig` directory. Results are in the phase 05 report, `plans/261113-1451-antigravity-plugin-port/reports/live-verification.md`.

This page lists which Rig features work in Google Antigravity (`agy`) and which need Claude Code. It covers install, update and uninstall for the Antigravity plugin, then the feature table.

## Install

Install a pinned release tag. Do not install from `main`.

```bash
agy plugin install https://github.com/hoadh/rig/tree/<tag>/antigravity/rig
```

Replace `<tag>` with a Rig release tag, for example `v2.0.10`. The plugin version has the form `<rig version>-agy.<n>`, for example `2.0.10-agy.1`.

Verified with `v2.0.10` on agy 1.5.4: the install gives `rig` `2.0.10-agy.1` with 29 skills, 14 agents, 1 rule and 4 hooks.

## Update

Antigravity has no `update` command. Update with uninstall and install:

```bash
agy plugin uninstall rig
agy plugin install https://github.com/hoadh/rig/tree/<new tag>/antigravity/rig
```

Uninstall leaves an empty `~/.gemini/antigravity-cli/plugin_data/rig/` directory. Remove it by hand if you want a clean state.

## Uninstall

```bash
agy plugin uninstall rig
```

## Conflict with a Claude Rig plugin

Antigravity can install the Claude Code Rig plugin directly (`agy plugin install https://github.com/hoadh/rig/tree/<tag>/plugins/rig`). Both Rig installs use the name `rig`. Installing either one over the other replaces the first silently. `agy plugin list` may keep the old Source label after a replace, so the list can be wrong.

Uninstall first, then install:

```bash
agy plugin uninstall rig
```

Then install the Antigravity plugin with the command above.

The Claude plugin installed in Antigravity works for skills, agents and rules. Its Rig hooks start, but they do not do their job there: they read Claude Code field names. Use the Antigravity plugin for hook behavior.

## Remove an old `.agent/` copy

Rig 1.x and early 2.x generated a `.agent/` directory and a root `GEMINI.md` for Antigravity. This generated copy is removed. Antigravity reads workspace config from `.agents/`, and the `.agent/` copy is no longer generated or tested.

To clean a project that still has the old copy:

```bash
rm -rf .agent GEMINI.md
```

Check first that you have no local edits in these files. They are generated, so edits there are lost on the next install.

## Python dependencies

Antigravity has no Rig venv. `rig-python` becomes `python3`, so skills that import packages need them installed in that Python. The `media` skill needs `google-genai`, `pypdf` and `pyyaml`. Install them with:

```bash
python3 -m pip install -r <Rig root>/skills/media/scripts/requirements.txt
```

`<Rig root>` is the path that SessionStart prints as `Rig root:`.

## Feature table

Legend:

| Status | Meaning |
|---|---|
| Yes | Verified live in Antigravity. |
| Partial | Works with a stated limit. |
| Not supported | Not in the host, or not ported by design. |

| Rig feature | Claude Code | Antigravity | Notes |
|---|---|---|---|
| Skills (`/plan`, `/implement`, `/fix`, ...) | Yes | Yes | No `rig:` prefix. Skill scripts run by absolute path |
| `media` skill (Python packages) | Yes | Partial | Packages must be pip-installed by the user. See [Python dependencies](#python-dependencies) |
| Skills that need extra bins or Python packages | Yes | Partial | Works when the tools and packages are on the machine |
| Agents (planner, tester, code-reviewer, ...) | Subagents | Yes | Verified live: a Rig subagent runs, and `code-reviewer` gets only its mapped tools (no `write_file` or `edit_file`). `model: inherit`. Claude `tools` lists map to Antigravity tool names; `send_message` and `manage_task` are always granted |
| Core rules | SessionStart hook | `rules/AGENTS.md` + SessionStart | Verified: the agent quoted the core rules and `Rig root:` |
| Plan context per prompt, active plan | UserPromptSubmit + env file | PreInvocation + session state | Verified: `Now:` stamp and plan context per user message; active plan updates on the next turn |
| Bash safety / secret-file guard | PreToolUse | PreToolUse | The matcher covers `run_command`, `send_command_input`, `read_file`, `view_file`, `view_file_outline` and `grep_search`. Only `run_command` and `read_file` were seen live: secret reads ask, and headless `agy -p` denies `ask`. Another plugin's hook can override this guard |
| Verify-on-stop | Stop | Stop | Verified in remind mode: an unverified code edit gets one nudge. Docs-only edits do not count |
| `SubagentStart` hook (subagent context injection) | SubagentStart | Not supported | Rules and the agent `skills:` field instead |
| `TeammateIdle` hook (Agent Teams guard) | TeammateIdle | Not supported | Antigravity has no Agent Teams |
| `team` skill (`rig:team`, Agent Teams) | Yes | Not supported | `/swarm` is a different model |
| `remote` skill (`rig:remote`) | Yes | Not supported | Needs `claude -p` workers |
| `statusline` skill (`/rig:statusline`) | Yes | Not supported | No statusline API |
| `setup` skill (`/rig:setup`), `rig-init` | Yes | Not supported | Install with `agy plugin install`. The 1.x migration is removed in 2.1.0 (Rig 2.0.10 only) |
| `create-skill` description optimizer | Yes | Not supported | Needs `claude -p` |
| Model names (opus, sonnet, haiku) | Yes | Not supported | Antigravity uses `inherit` or Gemini tiers |

Rows marked "Not supported" are not ported by design. They are listed so that a missing feature is documented, not silent.

## Not verified yet

- Interactive `force_ask` prompt (needs the Antigravity app or TUI).
- Hook precedence when another plugin also defines hooks.
- Guard on `send_command_input`, `view_file`, `view_file_outline` and `grep_search` (matched, not seen live).

## Related

- [Architecture](../explanation/architecture.md): plugin layout and hook design.
- [Install and update Rig](../how-to/install-and-update-rig.md): Claude Code install and update.
