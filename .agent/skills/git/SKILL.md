---
name: git
description: "Git operations with conventional commits: stage, commit, push, merge; splits commits by type and scans for secrets. Use when asked to commit, push or merge. Pull requests: /pr."
argument-hint: "cm|cp|merge [args]"
metadata:
  author: rig
  version: "1.0.0"
---

# Git Operations

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available git operations:

| Operation | Description |
|-----------|-------------|
| `cm` | Stage files & create commits |
| `cp` | Stage files, create commits and push |
| `merge` | Merge branches |

Present as options via `AskUserQuestion` with header "Git Operation", question "What would you like to do?".

Execute git workflows via `git-operator` subagent to isolate verbose output.
Activate `context-engineering` skill.

**IMPORTANT:**
- Sacrifice grammar for the sake of concision.
- Ensure token efficiency while maintaining high quality.
- Pass these rules to subagents.

## Arguments
- `cm`: Stage files & create commits
- `cp`: Stage files, create commits and push
- `merge`: Merge [to-branch] [from-branch]
  - `to-branch`: Target branch (default: main)
  - `from-branch`: Source branch (default: current branch)

## Quick Reference

| Task | Reference |
|------|-----------|
| Commit | `references/workflow-commit.md` |
| Push | `references/workflow-push.md` |
| Merge | `references/workflow-merge.md` |
| Standards | `references/commit-standards.md` |
| Safety | `references/safety-protocols.md` |
| Branches | `references/branch-management.md` |
| GitHub CLI | `references/gh-cli-guide.md` |

## Core Workflow

### Step 1: Stage + Analyze
```bash
git status --porcelain   # review for secret files first: never stage .env*, keys, credentials (templates .env.example, *.example, *.sample are fine); else add by path
git add -A && git diff --cached --stat && git diff --cached --name-only
```

### Step 2: Security Check
Scan for secrets before commit:
```bash
git diff --cached | grep -iE "(api[_-]?key|token|password|secret|credential)"
```
**If secrets found:** STOP, warn user, suggest `.gitignore`.

### Step 3: Split Decision

**NOTE:**
- Search for related issues on GitHub and add to body.
- Only use `feat`, `fix`, or `perf` prefixes for files in `.claude` directory (do not use `docs`).

**Split commits if:**
- Different types mixed (feat + fix, code + docs)
- Multiple scopes (auth + payments)
- Config/deps + code mixed
- FILES > 10 unrelated

**Single commit if:**
- Same type/scope, FILES ≤ 3, LINES ≤ 50

### Step 4: Commit
```bash
PRE=$(git rev-parse HEAD); git commit -m "type(scope): description"; [ "$(git rev-parse HEAD)" != "${PRE:?PRE unset}" ] && echo "committed $(git rev-parse --short HEAD)" || echo "nothing committed"
```

## Output Format
```
✓ staged: N files (+X/-Y lines)
✓ security: passed
✓ commit: HASH type(scope): description
✓ pushed: <short-hash> -> origin/<branch>   (only with proof from references/workflow-push.md)
```
Clean tree: exactly `nothing to commit (working tree clean)`. HEAD unchanged after commit: `nothing committed`. Never print a "pushed" line without the HEAD == remote proof (`ls-remote`).

## Error Handling

| Error | Action |
|-------|--------|
| Secrets detected | Block commit, show files |
| No changes | Exit cleanly |
| Push rejected | Suggest `git pull --rebase` |
| HEAD != remote after push | Report `✗ push NOT confirmed: HEAD <h1> != remote <h2|none>` |
| Merge conflicts | Suggest manual resolution |

## References

- `references/workflow-commit.md` - Commit workflow with split logic
- `references/workflow-push.md` - Push workflow with error handling
- `references/workflow-merge.md` - Branch merge workflow
- `references/commit-standards.md` - Conventional commit format rules
- `references/safety-protocols.md` - Secret detection, branch protection
- `references/branch-management.md` - Naming, lifecycle, strategies
- `references/gh-cli-guide.md` - GitHub CLI commands reference
