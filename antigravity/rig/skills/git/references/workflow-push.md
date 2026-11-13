# Push Workflow

Execute via `git-operator` subagent.

## Pre-Push Checklist
1. All changes committed
2. Secrets scanned (see `safety-protocols.md`)
3. Branch pushed to remote

## Tool 1: Verify State
```bash
git status && \
git log origin/$(git rev-parse --abbrev-ref HEAD)..HEAD --oneline 2>/dev/null || echo "NO_UPSTREAM"
```

**If uncommitted changes:** Warn user, suggest commit first.
**If NO_UPSTREAM:** Use `git push -u origin HEAD`.

## Tool 2: Push + Proof (one call)
<!-- push-proof -->
```bash
B=$(git branch --show-current); git push origin HEAD; echo "HEAD $(git rev-parse HEAD)"; echo "REMOTE $(git ls-remote origin "refs/heads/$B" | cut -f1)"
```
<!-- /push-proof -->

First push of a branch: use `git push -u origin HEAD` instead. The `;` separators are deliberate: the `HEAD`/`REMOTE` lines must print even when the push fails.

### Proof
Compare against the real remote ref (`ls-remote`), not `@{u}` (which may track `origin/main` for a branch created from it).
- `HEAD` == `REMOTE` (non-empty) -> report `✓ pushed: <short-hash> -> origin/<branch>`
- Otherwise -> report `✗ push NOT confirmed: HEAD <h1> != remote <h2|none>` plus the tail of push stderr
- Never report pushed without this proof line. Never push if the commit proof (see `workflow-commit.md`) failed.
- Nothing ahead of remote: output exactly `nothing to push`, no "pushed" line.

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `rejected - non-fast-forward` | Remote has newer commits | `git pull --rebase`, resolve conflicts, push again |
| `no upstream branch` | Branch not tracked | `git push -u origin HEAD` |
| `Authentication failed` | Invalid credentials | Check `gh auth status` or SSH keys |
| `Repository not found` | Wrong remote URL | Verify `git remote -v` |
| `Permission denied` | No write access | Check repository permissions |

## Force Push (DANGER)

**NEVER force push to main/master/production branches.**

If user explicitly requests force push on feature branch:
```bash
git push -f origin HEAD
```

**Warn user:** "Force push rewrites history. Collaborators may lose work."

## Output Format
```
✓ pushed: abc123 -> origin/{branch}
```
or
```
✗ push NOT confirmed: HEAD abc123 != remote def456
```
