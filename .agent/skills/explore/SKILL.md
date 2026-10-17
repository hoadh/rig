---
name: explore
description: "Explore the codebase fast with parallel agents. Use for file discovery, task context gathering, quick searches across directories. Supports internal (Explore) and external (Gemini CLI) agents."
argument-hint: "[search-target] [ext]"
metadata:
  author: rig
  version: "1.0.0"
---

# Explore

Fast, token-efficient codebase exploration using parallel agents to find files needed for tasks.

## Arguments
- Default: Explore using built-in Explore subagents in parallel (`./references/internal-exploration.md`)
- `ext`: Explore using external Gemini CLI in parallel (`./references/external-exploration.md`)

## When to Use

- Beginning work on feature spanning multiple directories
- User mentions needing to "find", "locate", or "search for" files
- Starting debugging session requiring file relationships understanding
- User asks about project structure or where functionality lives
- Before changes that might affect multiple codebase parts

## Quick Start

1. Analyze user prompt to identify search targets
2. Use a wide range of Grep and Glob patterns to find relevant files and estimate scale of the codebase
3. Spawn parallel agents with divided directories
4. Collect results into concise report

## Configuration

Read from `.agent/.rig.json`:
- `gemini.model` - Gemini model (default: `gemini-3-flash-preview`)

## Workflow

### 1. Analyze Task
- Parse user prompt for search targets
- Identify key directories, patterns, file types, lines of code
- Determine optimal SCALE value of subagents to spawn

### 2. Divide and Conquer
- Split codebase into logical segments per agent
- Assign each agent specific directories or patterns
- Ensure no overlap, maximize coverage

### 3. Register Explore Tasks
- **Skip if:** Agent count ≤ 2 (overhead exceeds benefit)
- **Skip if:** Task tools unavailable (VSCode extension) — use `TodoWrite` instead
- `TaskList` first — check for existing explore tasks in session
- If not found, `TaskCreate` per agent with scope metadata
- See `references/task-management-exploration.md` for patterns and examples

### 4. Spawn Parallel Agents
Load appropriate reference based on decision tree:
- **Internal (Default):** `references/internal-exploration.md` (Explore subagents)
- **External:** `references/external-exploration.md` (Gemini CLI)

**Notes:**
- `TaskUpdate` each task to `in_progress` before spawning its agent (skip if Task tools unavailable)
- Prompt detailed instructions for each subagent with exact directories or files it should read
- Remember that each subagent has less than 200K tokens of context window
- Amount of subagents to-be-spawned depends on the current system resources available and amount of files to be scanned
- Each subagent must return a detailed summary report to a main agent

### 5. Collect Results
**IMPORTANT:** Invoke "/project-organization" skill to organize the outputs.

- Timeout: 3 minutes per agent (skip non-responders)
- `TaskUpdate` completed tasks; log timed-out agents in report (skip if Task tools unavailable)
- Aggregate findings into single report
- List unresolved questions at end

## Report Format

```markdown
# Explore Report

## Relevant Files
- `path/to/file.ts` - Brief description
- ...

## Unresolved Questions
- Any gaps in findings
```

## References

- `references/internal-exploration.md` - Using Explore subagents
- `references/external-exploration.md` - Using Gemini CLI
- `references/task-management-exploration.md` - Claude Task patterns for explore coordination
