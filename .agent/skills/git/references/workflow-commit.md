# Commit Workflow

Execute via `git-operator` subagent.

## Tool 1: Stage + Analyze
Record HEAD first (`PRE=$(git rev-parse HEAD)`, keep the value for the commit proof below).

If the tree is clean and nothing is ahead of remote, output exactly `nothing to commit (working tree clean)` (for `cp` also `nothing to push` when ahead = 0) and stop. No "pushed" line.

```bash
git add -A && \
echo "=== STAGED ===" && git diff --cached --stat && \
echo "=== SECURITY ===" && \
git diff --cached | grep -c -iE "(api[_-]?key|token|password|secret|credential)" | awk '{print "SECRETS:"$1}' && \
echo "=== GROUPS ===" && \
git diff --cached --name-only | awk -F'/' '{
  if ($0 ~ /\.(md|txt)$/) print "docs:"$0
  else if ($0 ~ /test|spec/) print "test:"$0
  else if ($0 ~ /\.agent/) print "config:"$0
  else if ($0 ~ /package\.json|lock/) print "deps:"$0
  else print "code:"$0
}'
```

**If SECRETS > 0:** STOP, show matches, block commit.

## Tool 2: Split Decision

NOTE: 
- Search for related issues on GitHub and add to body.
- Only use `feat`, `fix`, or `perf` prefixes for files in `.claude` directory (do not use `docs`).

**From groups, decide:**

**A) Single commit:** Same type/scope, FILES ≤ 3, LINES ≤ 50

**B) Multi commit:** Mixed types/scopes, group by:
- Group 1: `config:` → `chore(config): ...`
- Group 2: `deps:` → `chore(deps): ...`
- Group 3: `test:` → `test: ...`
- Group 4: `code:` → `feat|fix: ...`
- Group 5: `docs:` → `docs: ...`

## Tool 3: Commit

**Single:**
```bash
git commit -m "type(scope): description"
```

**Multi (sequential):**
```bash
git reset && git add file1 file2 && git commit -m "type(scope): desc"
```
Repeat for each group.

### Commit proof
After committing, require HEAD to have moved (a rejecting pre-commit hook leaves it unchanged):
<!-- commit-proof -->
```bash
[ "$(git rev-parse HEAD)" != "$PRE" ] && echo "committed $(git rev-parse --short HEAD)" || echo "nothing committed"
```
<!-- /commit-proof -->
If `nothing committed`: report it, do NOT push.

## Tool 4: Push + Proof (if requested)
Same block as `workflow-push.md` (use `git push -u origin HEAD` on first push):
<!-- push-proof -->
```bash
B=$(git branch --show-current); git push origin HEAD; echo "HEAD $(git rev-parse HEAD)"; echo "REMOTE $(git ls-remote origin "refs/heads/$B" | cut -f1)"
```
<!-- /push-proof -->
Report `✓ pushed: <short-hash> -> origin/<branch>` ONLY when `HEAD` == `REMOTE` and the commit proof passed; else `✗ push NOT confirmed: HEAD <h1> != remote <h2|none>` + push stderr tail.

**Only push if user explicitly requested** ("push", "commit and push").
