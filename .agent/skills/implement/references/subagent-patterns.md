# Subagent Patterns

Standard patterns for spawning and using subagents in implement workflows.

## Agent Tool Pattern
```
Agent(subagent_type="[type]", prompt="[task description]", description="[brief]")
```

## Research Phase
```
Agent(subagent_type="researcher", prompt="Research [topic]. Report ≤150 lines.", description="Research [topic]")
```
- Use multiple researchers in parallel for different topics
- Keep reports ≤150 lines with citations

## Explore Phase
```
Agent(subagent_type="Explore", prompt="Find files related to [feature] in codebase", description="Explore [feature]")
```
- Use `/explore ext` (preferred) or `/explore` (fallback)

## Planning Phase
```
Agent(subagent_type="planner", prompt="Create implementation plan based on reports: [reports]. Save to [path]", description="Plan [feature]")
```
- Input: researcher and explore reports
- Output: `plan.md` + `phase-XX-*.md` files

## UI Implementation
```
Agent(subagent_type="ui-ux-designer", prompt="Implement [feature] UI per ./docs/reference/design-guidelines.md", description="UI [feature]")
```
- For frontend work
- Follow design guidelines

## Testing
```
Agent(subagent_type="tester", prompt="Run test suite for plan phase [phase-name]", description="Test [phase]")
```
- Must achieve 100% pass rate

## Debugging
```
Agent(subagent_type="debugger", prompt="Analyze failures: [details]", description="Debug [issue]")
```
- Use when tests fail
- Provides root cause analysis

## Code Review
```
Agent(subagent_type="code-reviewer", prompt="Review changes for [phase]. Check security, performance, YAGNI/KISS/DRY. Return score (X/10), critical, warnings, suggestions.", description="Review [phase]")
```

## Project Management
```
Agent(subagent_type="progress-tracker", prompt="Run full sync-back in [plan-path]: reconcile completed tasks with all phase files, backfill stale completed checkboxes across all phases, update plan.md status/progress, and report unresolved mappings.", description="Update plan")
```

## Documentation
```
Agent(subagent_type="docs-maintainer", prompt="Update docs for [phase]. Changed files: [list]", description="Update docs")
```

## Git Operations
```
Agent(subagent_type="git-operator", prompt="Stage and commit changes with conventional commit message", description="Commit changes")
```

## Parallel Execution
```
Agent(subagent_type="implementer", prompt="Implement [phase-file] with file ownership: [files]", description="Implement phase [N]")
```
- Launch multiple for parallel phases
- Include file ownership boundaries
