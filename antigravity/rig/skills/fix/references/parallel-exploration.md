# Parallel Exploration

> Tasks API is optional (off by default): create tasks only if `TaskCreate` is available; otherwise track steps in the phase files. The `TaskCreate`/`TaskUpdate` calls below apply only when it is available.

Patterns for launching multiple subagents in parallel to explore codebase, verify implementation, and coordinate via native Tasks.

## Parallel Exploration

Launch multiple `Explore` subagents simultaneously when needing to find:
- Related files across different areas
- Similar implementations/patterns
- Dependencies and usage

**Pattern:**
```
Agent(subagent_type="Explore", prompt="Find [X] in [area1]", description="Explore area1")
Agent(subagent_type="Explore", prompt="Find [Y] in [area2]", description="Explore area2")
Agent(subagent_type="Explore", prompt="Find [Z] in [area3]", description="Explore area3")
```

**Example - Multi-area exploration:**
```
// Launch in SINGLE message with multiple Task calls:
Agent(subagent_type="Explore", prompt="Find auth-related files in src/", description="Explore auth")
Agent(subagent_type="Explore", prompt="Find API routes handling users", description="Explore API")
Agent(subagent_type="Explore", prompt="Find test files for auth module", description="Explore tests")
```

## Parallel Verification (Bash)

Run several Bash tool calls in a single message (parallel tool calls) to verify the implementation from different angles. There is no built-in Bash agent type.

**Pattern:**
```
Bash: [command1]
Bash: [command2]
```

**Example - Multi-verification:**
```
// Issue these Bash calls in a SINGLE message:
Bash: typecheck: bun run typecheck
Bash: lint: bun run lint
Bash: build: bun run build
```

## Task-Coordinated Parallel (Moderate+)

For multi-phase fixes, use native Tasks to coordinate parallel agents.
See `references/task-orchestration.md` for full patterns.

**Pattern - Parallel issue trees:**
```
// Create separate task trees per independent issue
T_A1 = TaskCreate(subject="[Issue A] Debug", activeForm="Debugging A")
T_A2 = TaskCreate(subject="[Issue A] Fix",   activeForm="Fixing A",   addBlockedBy=[T_A1])
T_B1 = TaskCreate(subject="[Issue B] Debug", activeForm="Debugging B")
T_B2 = TaskCreate(subject="[Issue B] Fix",   activeForm="Fixing B",   addBlockedBy=[T_B1])
T_final = TaskCreate(subject="Integration verify", addBlockedBy=[T_A2, T_B2])

// Spawn agents per issue tree
Agent(subagent_type="implementer", prompt="Fix Issue A. Claim tasks via TaskUpdate.", description="Fix A")
Agent(subagent_type="implementer", prompt="Fix Issue B. Claim tasks via TaskUpdate.", description="Fix B")
```

Agents claim work via `TaskUpdate(status="in_progress")` and complete via `TaskUpdate(status="completed")`. Blocked tasks auto-unblock when dependencies resolve.

## When to Use Parallel

| Scenario | Parallel Strategy |
|----------|-------------------|
| Root cause unclear, multiple suspects | 2-3 Explore agents on different areas |
| Multi-module fix | Explore each module in parallel |
| After implementation | parallel Bash calls for typecheck + lint + build |
| Before commit | parallel Bash calls for test + build + lint |
| 2+ independent issues | Task trees per issue + implementer agents |

## Combining Explore + Tasks + Bash

**Step 1:** Parallel Explore agents
**Step 2:** Sequential implementation (update Tasks as phases complete)
**Step 3:** Parallel Bash to verify

```
// Explore phase - parallel
Agent(subagent_type="Explore", prompt="Find payment handlers", description="Explore payments")
Agent(subagent_type="Explore", prompt="Find order processors", description="Explore orders")

// Wait for results, implement fix, TaskUpdate each phase

// Verify phase - parallel
Bash: tests: bun test
Bash: typecheck
Bash: build
```

## Resource Limits

- Max 3 parallel agents recommended (system resources)
- Each subagent has 200K token context limit
- Keep prompts concise to avoid context bloat
- Use `TaskList()` to check for available unblocked work
