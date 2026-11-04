# Orchestration Protocol

Subagents are for isolation, parallelism or an independent review (see tiers in `primary-workflow.md`). Spawn them only when that benefit exists.

## Delegation Context
Every subagent prompt includes the work context path (git root of the primary files), reports path (`{work_context}/plans/reports/`) and plans path (`{work_context}/plans/`). If CWD differs from the work context, use the work context paths. Without them, subagents write reports to the wrong project.

## Chaining and Parallelism
- Chain when output feeds the next step: Plan, Implement, Test, Review; or Research, Design, Code, Docs.
- Run in parallel only independent work with non-overlapping files; plan integration points first.

## Subagent Status Protocol
Subagents end with one status:

| Status | Meaning | Controller action |
|---|---|---|
| DONE | Completed | Proceed |
| DONE_WITH_CONCERNS | Completed with doubts | Fix correctness/scope concerns first; note observational ones and proceed |
| BLOCKED | Cannot complete | Change something before retrying: more context, simpler task, stronger model, or escalate. Never retry the same approach |
| NEEDS_CONTEXT | Missing information | Supply it and re-dispatch |

After 3 failures on the same task, escalate to the user.

Report format:
```
**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
**Summary:** [1-2 sentences]
**Concerns/Blockers:** [if applicable]
```

## Context Isolation
Subagents get only what they need, never session history: task, files to read/modify, acceptance criteria, constraints, plan phase text (not the whole plan), work context and reports paths. Write "Implement X per phase-02.md" or "Fix null check in auth.ts:45, cause: missing validation", not "continue where we left off". Coordination stays in the main agent.

## Agent Teams
For multi-session collaboration use `/rig:team` (`.claude/skills/team/SKILL.md`); it is not part of the default flow.
