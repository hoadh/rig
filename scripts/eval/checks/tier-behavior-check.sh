#!/usr/bin/env bash
# Behavioral tier check (costs API tokens, run manually).
# Copies the repo to a scratch dir, runs 3 headless prompts (trivial/standard/large)
# and saves stream-json evidence. Asserts: trivial spawns 0 subagents; large invokes planning.
# Usage: tier-behavior-check.sh <evidence-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: tier-behavior-check.sh <evidence-dir>}"
mkdir -p "$OUT"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
# Tracked files only: untracked files (e.g. .env with keys) must not reach the scratch dir.
git -C "$ROOT" archive HEAD | tar -C "$SCRATCH" -xf -
cd "$SCRATCH"
git init -q && git add -A >/dev/null && git -c user.email=a@b -c user.name=t commit -qm init
printf 'The quick brown fox jumpd over the lazy dog.\n' > notes.txt
mkdir -p src src/auth db/migrations infra
printf 'export const login = (u, p) => u === "admin" && p === "admin"; // legacy basic auth\n' > src/auth/login.js
printf 'CREATE TABLE users (id INT PRIMARY KEY, name TEXT, password TEXT);\n' > db/migrations/001_users.sql
printf 'resource "aws_lb" "api" {}\n' > infra/main.tf

run() { # name prompt max-turns
  claude -p "$2" --output-format stream-json --verbose --max-turns "$3" \
    --permission-mode acceptEdits --allowedTools "Read Edit Write Bash Skill Agent Task Glob Grep" \
    > "$OUT/$1.stream.jsonl" 2> "$OUT/$1.stderr" || echo "claude exited non-zero for $1 (see stderr)"
}
# Count tool_use blocks by name, matching parsed JSON (not key order). jq if present, else node.
count_tool() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg n "$2" 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name==$n) | .id' "$OUT/$1.stream.jsonl" 2>/dev/null | wc -l
  else
    node -e '
      const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
      let n = 0;
      for (const l of lines) { try { const o = JSON.parse(l); if (o.type === "assistant") for (const c of (o.message && o.message.content) || []) if (c.type === "tool_use" && c.name === process.argv[2]) n++; } catch {} }
      console.log(n);' "$OUT/$1.stream.jsonl" "$2"
  fi | tr -d ' '
}

run trivial  "Fix the typo 'jumpd' in notes.txt." 6
run standard "Add an isEven(n) function to src/math.js plus a small node:test test in src/math.test.js, and run it." 12
run large    "We need to migrate src/auth/login.js from basic auth to OAuth2, with a users-table migration in db/migrations and infra changes in infra/. Produce the implementation plan only; do not write code yet." 12

fail=0
t_sub=$(( $(count_tool trivial Agent) + $(count_tool trivial Task) ))
echo "trivial: subagent calls=$t_sub (expect 0)"; [ "$t_sub" -eq 0 ] || fail=1
s_sub=$(( $(count_tool standard Agent) + $(count_tool standard Task) ))
echo "standard: subagent calls=$s_sub (informational)"
l_plan=$({ grep -o '"name":"Skill"[^}]*plan\|"subagent_type":"planner"\|plans/[^"]*plan.md' "$OUT/large.stream.jsonl" || true; } | wc -l)
echo "large: plan references=$l_plan (expect >0)"; [ "$l_plan" -gt 0 ] || fail=1
exit $fail
