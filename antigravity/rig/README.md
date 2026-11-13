# Rig for Antigravity

Rig 2.0.10 as an Antigravity plugin (plugin version `2.0.10-agy.1`). Generated from `plugins/rig/` by `scripts/sync-antigravity-plugin.cjs`; do not edit by hand.

It carries the Rig skills, subagents, always-on rules and the hooks that have an Antigravity equivalent.
Claude-only parts (statusline, setup, `remote`, `team`, Agent Teams hooks) are not included.

## Install

Pin the install to a release tag:

```bash
agy plugin install https://github.com/hoadh/rig/tree/v2.0.10/antigravity/rig
```

If you installed the Claude plugin natively under the same name `rig`, uninstall it first.

## Update

`agy` has no `update` command: uninstall the plugin, then install the new tag.

## Feature map

What works, what is partial and what is missing: https://github.com/hoadh/rig/blob/main/docs/reference/antigravity-feature-map.md
