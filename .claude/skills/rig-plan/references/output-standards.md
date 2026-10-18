# Output Standards & Quality

## Plan File Format

### YAML Frontmatter (Required for plan.md)

All `plan.md` files MUST include YAML frontmatter at the top:

```yaml
---
title: "{Brief plan title}"
description: "{One-sentence summary for card preview}"
status: pending  # pending | in-progress | completed | cancelled
priority: P2     # P1 (High) | P2 (Medium) | P3 (Low)
issue: 74        # GitHub issue number (if applicable)
branch: kai/feat/feature-name
tags: [frontend, api]  # Category tags
blockedBy: []    # Plan dirs this plan waits on (e.g., [260301-1200-auth-system])
blocks: []       # Plan dirs this plan blocks (e.g., [260228-0900-user-dashboard])
created: 2025-12-16
---
```

### Multi-Machine Fields (only for plans using `/rig:remote`)

Optional; single-machine plans omit them all. `plan.md` frontmatter: `orchestrator: <machine-id>` (set by `rig:remote` on first dispatch; do not hand-edit) and `branch:` (shared base branch, required to dispatch). Phase file frontmatter:

```yaml
machine: win11        # machine id from the registry; absent = this machine
owns: ["src/win/**"]  # REQUIRED for remote phases; disjoint across machines
dependsOn: [01]       # phase ids whose collected output this phase needs
reviewedSha: <sha>    # written by the orchestrator via `remote review`, never by the planner
reviewScore: 9        # same
```

`owns` globs may not touch `.git*`, `.github/`, `.claude/`, CI or hook paths unless listed explicitly. Same-machine phases are contiguous. Put the per-machine test command in each remote phase's Success Criteria (used for `collect --test machine=cmd`). See `/rig:remote`.

### Auto-Population Rules

When creating plans, auto-populate these fields:
- **title**: Extract from task description
- **description**: First sentence of Overview section
- **status**: Always `pending` for new plans
- **priority**: From user request or default `P2`
- **issue**: Parse from branch name or context
- **branch**: Current git branch (`git branch --show-current`)
- **tags**: Infer from task keywords (e.g., frontend, backend, api, auth)
- **blockedBy**: Detected during pre-creation scan (empty `[]` if none)
- **blocks**: Detected during pre-creation scan (empty `[]` if none)
- **created**: Today's date in YYYY-MM-DD format

### Tag Vocabulary (Recommended)

Use these predefined tags for consistency:
- **Type**: `feature`, `bugfix`, `refactor`, `docs`, `infra`
- **Domain**: `frontend`, `backend`, `database`, `api`, `auth`
- **Scope**: `critical`, `tech-debt`, `experimental`

### Task Naming Conventions

**subject** (imperative): Action verb + deliverable, <60 chars
  Examples: "Setup database migrations", "Implement OAuth2 flow"

**activeForm** (continuous): Present participle of subject
  Examples: "Setting up database", "Implementing OAuth2"

**description**: 1-2 sentences, concrete deliverables, reference phase file

See `task-management.md` for full TaskCreate patterns and metadata.

## Task Breakdown

- Transform complex requirements into manageable, actionable tasks
- Each task independently executable with clear dependencies
- Prioritize by dependencies, risk, business value
- Eliminate ambiguity in instructions
- Include specific file paths for all modifications
- Provide clear acceptance criteria per task

### File Management

List affected files with:
- Full paths (not relative)
- Action type (modify/create/delete)
- Brief change description
- Dependencies on other changes
- Fully respect the `./docs/development-rules.md` file.

## Workflow Process

1. **Initial Analysis** → Read docs, understand context
2. **Research Phase** → Spawn researchers in parallel, investigate approaches
3. **Synthesis** → Analyze reports, identify optimal solution
4. **Design Phase** → Create architecture, implementation design
5. **Plan Documentation** → Write comprehensive plan in Markdown
6. **Review & Refine** → Ensure completeness, clarity, actionability

## Output Requirements

### What Planners Do
- Create plans ONLY (no implementation)
- Provide plan file path and summary
- Self-contained plans with necessary context
- Code snippets/pseudocode when clarifying
- Multiple options with trade-offs when appropriate
- Fully respect the `./docs/development-rules.md` file.

### Writing Style
**IMPORTANT:** Sacrifice grammar for concision
- Focus clarity over eloquence
- Use bullets and lists
- Short sentences
- Remove unnecessary words
- Prioritize actionable info

### Unresolved Questions
**IMPORTANT:** Use `AskUserQuestion` to ask users for unresolved questions at the end
- Questions needing clarification
- Technical decisions requiring input
- Unknowns impacting implementation
- Trade-offs requiring business decisions
Revise the plan and phases based on the answers.

## Quality Standards

### Thoroughness
- Thorough and specific in research/planning
- Consider edge cases, failure modes
- Think through entire user journey
- Document all assumptions

### Maintainability
- Consider long-term maintainability
- Design for future modifications
- Document decision rationale
- Avoid over-engineering
- Fully respect the `./docs/development-rules.md` file.

### Research Depth
- When uncertain, research more
- Multiple options with clear trade-offs
- Validate against best practices
- Consider industry standards

### Security & Performance
- Address all security concerns
- Identify performance implications
- Plan for scalability
- Consider resource constraints

### Implementability
- Detailed enough for junior developers
- Validate against existing patterns
- Ensure codebase standards consistency
- Provide clear examples

**Remember:** Plan quality determines implementation success. Be comprehensive, consider all solution aspects.
