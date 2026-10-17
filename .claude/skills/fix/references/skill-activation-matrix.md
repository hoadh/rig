# Skill Activation Matrix

When to activate each skill and tool during fixing workflows.

## Always Activate (ALL Workflows)

| Skill/Tool | Step | Reason |
|------------|------|--------|
| `rig:explore` OR parallel `Explore` | Step 1 | Understand codebase context before diagnosing |
| `rig:debug` | Step 2 | Systematic root cause investigation |
| `rig:sequential-thinking` | Step 2 | Structured hypothesis formation — NO guessing |

## Task Orchestration (Moderate+ Only)

| Tool | Activate When |
|------|---------------|
| `TaskCreate` | After complexity assessment, create all phase tasks upfront |
| `TaskUpdate` | At start/completion of each phase |
| `TaskList` | Check available unblocked work, coordinate parallel agents |
| `TaskGet` | Retrieve full task details before starting work |

Skip Tasks for Quick workflow (< 3 steps). See `references/task-orchestration.md`.

## Auto-Triggered Activation

| Skill | Auto-Trigger Condition |
|-------|------------------------|
| `rig:problem-solving` | 2+ hypotheses REFUTED in Step 2 diagnosis |
| `rig:sequential-thinking` | Always in Step 2 (mandatory for hypothesis formation) |

## Conditional Activation

| Skill | Activate When |
|-------|---------------|
| `rig:brainstorm` | Multiple valid fix approaches, architecture decision (Deep only) |
| `rig:context-engineering` | Fixing AI/LLM/agent code, context window issues |
| `rig:media` | UI issues, screenshots provided, visual bugs |
| `rig:progress` | Moderate+ workflows — task hydration, sync-back, progress tracking |

## Subagent Usage

| Subagent | Activate When |
|----------|---------------|
| `debugger` | Root cause unclear, need deep investigation (Step 2) |
| `Explore` (parallel) | Explore multiple areas simultaneously (Step 1), test hypotheses (Step 2) |
| `Bash` (parallel) | Verify implementation: typecheck, lint, build, test (Step 5) |
| `researcher` | External docs needed, latest best practices (Deep only) |
| `planner` | Complex fix needs breakdown, multiple phases (Deep only) |
| `tester` | After implementation, verify fix works (Step 5) |
| `rig:code-review` | After fix, verify quality and security (Step 5) |
| `git-operator` | After approval, commit changes (Step 6) |
| `docs-maintainer` | API/behavior changes need doc updates (Step 6) |
| `progress-tracker` | Major fix impacts roadmap/plan status (Step 6) |
| `implementer` | Parallel independent issues (each gets own agent) |

## Parallel Patterns

See `references/parallel-exploration.md` for detailed patterns.

| When | Parallel Strategy |
|------|-------------------|
| Exploration (Step 1) | 2-3 `Explore` agents on different areas |
| Testing hypotheses (Step 2) | 2-3 `Explore` agents per hypothesis |
| Multi-module fix | `Explore` each module in parallel |
| After implementation (Step 5) | `Bash` agents: typecheck + lint + build + test |
| 2+ independent issues | Task trees + `implementer` agents per issue |

## Workflow → Skills Map

| Workflow | Skills Activated |
|----------|------------------|
| Quick | `rig:explore` (minimal), `rig:debug`, `rig:sequential-thinking`, `rig:code-review`, parallel `Bash` verification |
| Standard | Above + Tasks, `rig:problem-solving` (auto), `rig:progress`, `tester`, parallel `Explore` |
| Deep | All above + `rig:brainstorm`, `rig:context-engineering`, `researcher`, `planner` |
| Parallel | Per-issue Task trees + `rig:progress` + `implementer` agents + coordination via `TaskList` |

## Step → Skills Chain (Mandatory Order)

| Step | Mandatory Chain |
|------|----------------|
| Step 0: Mode | `AskUserQuestion` (unless auto/quick detected) |
| Step 1: Explore | `rig:explore` OR 2-3 parallel `Explore` → map files, deps, tests |
| Step 2: Diagnose | Capture pre-fix state → `rig:debug` → `rig:sequential-thinking` → parallel `Explore` hypotheses → (`rig:problem-solving` if 2+ fail) |
| Step 3: Assess | Classify complexity → create Tasks (moderate+) |
| Step 4: Fix | Implement per workflow → follow root cause |
| Step 5: Verify+Prevent | Iron-law verify → regression test → defense-in-depth → parallel `Bash` verify |
| Step 6: Finalize | Report → `docs-maintainer` → `TaskUpdate` → `git-operator` → `/rig:devlog` |

## Detection Triggers

| Keyword/Pattern | Skill to Consider |
|-----------------|-------------------|
| "AI", "LLM", "agent", "context" | `rig:context-engineering` |
| "stuck", "tried everything" | `rig:problem-solving` |
| "complex", "multi-step" | `rig:sequential-thinking` |
| "which approach", "options" | `rig:brainstorm` |
| "latest docs", "best practice" | `researcher` subagent |
| Screenshot attached | `rig:media` |
