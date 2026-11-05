# Claude Code native alignment: plan (1.1 cleanup + 2.0 plugin)

Date: 2026-11-04 · Status: planned, not started · Branch: `feat/update-based-on-changelog`

## What
Brainstorm against the Claude Code changelog (up to 2.1.318) → two plans:
- `plans/261104-1530-rig-1-1-context-reduction-and-cleanup/` — 1.1.0 on current layout: move rule sections into owning skills, core rules ≤1.5KB, trim agent/skill descriptions, dead tool refs, fix `team`, delete sequential-thinking, notify.cjs and output styles, `normalizeAgentType`, remote denylist. Blocked by plan 1427.
- `plans/261104-1426-claude-code-native-alignment/` — 2.0.0: Rig as a Claude Code plugin + in-repo marketplace, `bin/` entrypoints, minimal `rig-init` migrator, Antigravity sync. Blocked by 1530 and 1427.

## Findings that drove it
- Global + project install loaded CLAUDE.md and rules twice (~23KB × 2 per session).
- Broken against current Claude Code: `team` calls `TeamCreate` (removed 2.1.178); Tasks API off by default on current models, so task hydration silently skipped; `MultiEdit`/`LS` in 9+ agents.
- Dead code: `notify.cjs` never registered; output styles off by default.
- Plugins cannot ship rules, CLAUDE.md, statusLine or permissions; plugin agents ignore `hooks`/`mcpServers`/`permissionMode`.

## Decisions
- Plugin over copy installer (user). Split into 1.1 then 2.0 after red team: the context and cleanup work does not need packaging, and 2.0 needs a `v1.1.0` rollback tag.
- Keep markdown-viewer (Artifact is cloud and plan-gated), monorepo worktree selection, `team` as a thin rewrite.
- 1427 P4 (installer dedupe) and P5 (skill packs) cancelled: superseded by the plugin.
- Deferred to 2.1: Workflow `--workflow`, remote Monitor follow mode, SubagentStop status guard.

## Red team
4 reviewers, 40 raw → 15 findings (7 Critical), all accepted. Critical: sha256 migrator manifest could not match real installs (only `v1.0.0` tagged, 30 commits since); interrupted migration left settings pointing at deleted hooks; remote worker path hardcoded to the 1.x install; hooks keyed on bare agent type break under `rig:` names; 5KB budget unreachable (skill descriptions alone ~6.3KB); dropping yields logic double-fires hooks in team repos; statusline shim could load code from a same-named project marketplace.

## Lessons
- Two sessions planned overlapping work in parallel; one session could not see the other's plan in a worktree and wrote that it "absorbs" it. Keep plans where every session can see them, or link them both ways right away.
- Research corrected the brainstorm three times (markdown-viewer, agent hooks, plugin settings). Check platform limits before you approve the design, not after.
