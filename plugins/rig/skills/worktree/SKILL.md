---
name: worktree
description: "Create an isolated git worktree for parallel development. Use when starting a feature that must not touch the current checkout."
argument-hint: "[feature-description] OR [project] [feature]"
metadata:
  author: rig
  version: "1.1.0"
---

# Git Worktree

Isolated worktree for parallel work. Standalone repos use native Claude Code; the script only adds monorepo (submodule) project selection.

## Step 1: Detect repo type

```bash
node .claude/skills/worktree/scripts/worktree.cjs info --json
```

Read `repoType`, `projects`, `baseBranch`.

## Standalone repo: use native

- New session in a worktree: `claude --worktree <name>`.
- Inside a session: the built-in `EnterWorktree` tool.
- Base branch: set `worktree.baseRef` in settings.
- Gitignored files to carry over (config, local settings): `.worktreeinclude` at the repo root. Template: `references/worktreeinclude-example`. It does NOT include `.env`; adding it copies secrets into every worktree.

## Monorepo (`repoType === "monorepo"`)

1. If the project is not given, ask with `AskUserQuestion` (options from `projects`).
2. Pick a prefix from the description (fix, refactor, docs, test, chore, perf; default feat). For an exact branch name (e.g. `ABC-1234-x`) use `--no-prefix`.
3. Slug: kebab-case, max 50 chars.
4. Run:
```bash
node .claude/skills/worktree/scripts/worktree.cjs create "<PROJECT>" "<SLUG>" --prefix <TYPE>
```
Options: `--no-prefix`, `--worktree-root <path>`, `--json`, `--dry-run`. Other commands: `remove <name-or-path>`, `list`, `info`.
5. Install dependencies in the new worktree from its lockfile (bun, pnpm, yarn, npm, poetry, pip, cargo, go).

The script places worktrees under the superproject or monorepo `worktrees/` dir and copies `.env*.example` templates with the suffix removed.
