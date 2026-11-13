# Antigravity Plugin Port Implemented

**Date**: 2026-11-13 15:45
**Severity**: Medium
**Component**: Antigravity output, hook adapter, generator, CI, release
**Status**: Implemented on `feat/antigravity-plugin-port`, not merged. All local checks green; live checks on agy 1.5.4 pass except install from a release tag (needs the tag).

## What Happened

Plan 261113-1451 replaced the generated `.agent/` kit and root `GEMINI.md` with a generated Antigravity plugin in `antigravity/rig/` (version `2.0.10-agy.1`). Rig's hooks run there through an adapter in `scripts/antigravity/hooks/`; the hook logic in `plugins/rig/` is unchanged. A red team (4 reviewers, 40 raw findings merged to 15) reshaped the plan before any code, and phase 01 was a live probe with a go/no-go gate.

## Impact

- Antigravity users install with `agy plugin install https://github.com/hoadh/rig/tree/<tag>/antigravity/rig`: 29 skills, 14 subagents, the core rules, and four hooks (session context, per-prompt plan context, secret-file guard, verify-on-stop).
- Not ported, by design: `rig:remote`, `rig:team`, `setup`, `statusline`, SubagentStart and TeammateIdle hooks. The [feature map](../reference/antigravity-feature-map.md) lists every feature and its status.
- Breaking for anyone who copied `.agent/` into a project.

## Technical Details

- The probe found that a PreToolUse hook printing `{}` denies the tool call in Antigravity; empty stdout allows. The adapter never prints `{}`.
- `${PLUGIN_ROOT}` expands in `hooks.json` but not in `SKILL.md`, so SessionStart injects `Rig root: <path>` and skills call scripts under it.
- `PreInvocation` fires per model call; the reminder runs only when `invocationNum` is 0.
- Shell commands get `ANTIGRAVITY_CONVERSATION_ID`, so the Antigravity copy of `set-active-plan` keys session state on it.
- Agy also installs the Claude plugin natively (skills, agents, rules work; hooks become no-ops). The user chose the generated plugin for full hook support.

## Lessons Learned

- Probe live before building on docs. Three plan assumptions were wrong (`{}` semantics, `${PLUGIN_ROOT}` in skills, PreInvocation frequency).
- Our own injected context lands in the host transcript. The reminder's "recently injected" check then suppressed every later plan context; the adapter now hides the transcript from that hook.
- A verify-on-stop test must edit a code file: `.txt` edits count as docs by design, which looked like a bug.

## Next Steps

- Release with a tag, then verify `agy plugin install` from that tag.
- Admin: add the `antigravity/rig/ matches plugins/rig/` job to the `main-ci-required` ruleset.
- Open: per-agent tool restriction (agents inherit all tools), interactive `force_ask` prompt, hook precedence with other plugins.
