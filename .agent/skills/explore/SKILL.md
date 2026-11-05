---
name: explore
description: "Explore the codebase fast with parallel agents. Use for file discovery, gathering task context, quick searches across directories."
argument-hint: "[search-target] [ext]"
metadata:
  author: rig
  version: "1.1.0"
---

# Explore

Find the files a task needs. Default: the built-in `Explore` agent. `ext`: Gemini CLI.

## Default (built-in Explore agent)

1. Turn the prompt into search targets (names, patterns, directories).
2. Spawn `Explore` agents via the Agent tool with `subagent_type: "Explore"`. State breadth in the prompt: "medium" or "very thorough". Split by directory and run in one message when the scope is large; one agent suffices for a narrow question.
3. Each agent returns paths with one-line reasons; no file dumps.
4. Merge into the report below. Save it per `/project-organization` only if the caller asks for a file.

## `ext` (external Gemini CLI)

Read `references/external-exploration.md`. Config: `.agent/.rig.json` `gemini.model` (default `gemini-3-flash-preview`). Fall back to the default path when `gemini` is not installed.

## Report

```markdown
# Explore Report
## Relevant Files
- `path/to/file.ts` - why it matters
## Unresolved Questions
- gaps in findings
```
