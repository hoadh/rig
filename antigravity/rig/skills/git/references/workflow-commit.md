# Commit Workflow

Execute via `git-operator` subagent.

## Tool 1: Stage + Analyze
If the tree is clean and nothing is ahead of remote, output exactly `nothing to commit (working tree clean)` (for `cp` also `nothing to push` when ahead = 0) and stop. No "pushed" line.

```bash
# Review porcelain first: stop if secret files (.env*, keys, credentials) would be swept in. Templates (.env.example, *.example, *.sample) are fine.
if git status --porcelain | grep -iE '(^|[ /])\.env[^ ]*$|\.(pem|key|p12|keystore)$|credentials|secrets\.json' | grep -viE '\.(example|sample)$'; then echo 'SECRET-FILES: stage by explicit path, skip these'; exit 1; fi
git add -A && \
echo "=== STAGED ===" && git diff --cached --stat && \
echo "=== SECURITY ===" && \
git diff --cached | grep -c -iE "(api[_-]?key|token|password|secret|credential)" | awk '{print "SECRETS:"$1}' && \
echo "=== GROUPS ===" && \
git diff --cached --name-only | awk -F'/' '{
  if ($0 ~ /\.(md|txt)$/) print "docs:"$0
  else if ($0 ~ /test|spec/) print "test:"$0
  else if ($0 ~ /\.agents/) print "config:"$0
  else if ($0 ~ /package\.json|lock/) print "deps:"$0
  else print "code:"$0
}'
```

**If SECRETS > 0:** STOP, show matches, block commit.

**Staging rule:** `git add -A` / `git add .` only after `git status --porcelain` was reviewed for secret files (never stage `.env*`, keys, credentials; templates `.env.example`, `*.example`, `*.sample` may be committed). If any appear, stage by explicit path instead.

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

Commit and proof run in ONE Bash call: Bash calls do not share shell variables, so `PRE` must be captured in the same block that commits and checks (a missing `PRE` fails loudly via `${PRE:?}`, never a false "committed").

**Single:** stage first (Tool 1), then run the commit proof block below with the real message.

**Multi (sequential):** per group run `git reset && git add file1 file2` then the block below (one call per group, message changed).

### Commit proof
HEAD must move (a rejecting pre-commit hook leaves it unchanged). Capture, commit, check in this single block:
<!-- commit-proof -->
```bash
PRE=$(git rev-parse HEAD); git commit -m "type(scope): description"; [ "$(git rev-parse HEAD)" != "${PRE:?PRE unset}" ] && echo "committed $(git rev-parse --short HEAD)" || echo "nothing committed"
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
