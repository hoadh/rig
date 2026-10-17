# Plan Creation & Organization

## Directory Structure

### Plan Location

Use `Plan dir:` from `## Naming` section injected by hooks. This is the full computed path.

**Example:** `plans/251101-1505-authentication/` or `ai_docs/feature/MRR-1453/`

### File Organization

IN CURRENT WORKING PROJECT DIRECTORY:
```
{plan-dir}/                                    # From `Plan dir:` in ## Naming
├── research/
│   ├── researcher-XX-report.md
│   └── ...
├── reports/
│   ├── explore-report.md
│   ├── researcher-report.md
│   └── ...
├── plan.md                                    # Overview access point
├── phase-01-setup-environment.md              # Setup environment
├── phase-02-implement-database.md             # Database models
├── phase-03-implement-api-endpoints.md        # API endpoints
├── phase-04-implement-ui-components.md        # UI components
├── phase-05-implement-authentication.md       # Auth & authorization
├── phase-06-implement-profile.md              # Profile page
└── phase-07-write-tests.md                    # Tests
```

### Task Hydration

After creating plan.md and phase files, hydrate tasks (unless `--no-tasks`):
1. TaskCreate per phase with `addBlockedBy` dependency chain
2. Add critical step tasks for high-risk items
3. See `task-management.md` for patterns and implement handoff protocol

### Active Plan State Tracking

See SKILL.md "Active Plan State" section for full rules. Key points:
- Check `## Plan Context` injected by hooks for active/suggested/none state
- After creating plan: `node .agent/scripts/set-active-plan.cjs {plan-dir}`
- Active plans use plan-specific reports path; suggested plans use default path

## Plan Creation

After determining phases from research/design:

1. **Write plan.md** using the canonical 3-column phases table (`| Phase | Name | Status |`)
   plus YAML frontmatter (see `output-standards.md`):
   - `## Overview` — brief description
   - `## Dependencies` — cross-plan dependencies

2. **Write each phase-XX.md** with:
   - Architecture, implementation steps, success criteria
   - Requirements, risk assessment, security considerations

3. **Structural changes** (status, new phases): edit plan.md directly — only touch the
   Status cell or add a row; keep the 3-column table structure intact.

## File Structure

### Overview Plan (plan.md)

**IMPORTANT:** All plan.md files MUST include YAML frontmatter. See `output-standards.md` for schema.

**Example plan.md structure:**
```markdown
---
title: "Feature Implementation Plan"
description: "Add user authentication with OAuth2 support"
status: pending
priority: P1
effort: 8h
issue: 123
branch: kai/feat/oauth-auth
tags: [auth, backend, security]
blockedBy: []
blocks: [260115-0900-user-dashboard]
created: 2025-12-16
---

# Feature Implementation Plan

## Overview

Brief description of what this plan accomplishes.

## Cross-Plan Dependencies

| Relationship | Plan | Status |
|-------------|------|--------|
| Blocks | [260115-0900-user-dashboard](../260115-0900-user-dashboard/plan.md) | pending |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Setup Environment](./phase-01-setup.md) | Pending |
| 2 | [Core Implementation](./phase-02-impl.md) | Pending |
| 3 | [Testing & Validation](./phase-03-test.md) | Pending |

<!-- IMPORTANT: Link text MUST be human-readable names (not filenames).
     Bad:  [phase-01-setup.md](./phase-01-setup.md)
     Good: [Setup Environment](./phase-01-setup.md) -->

## Dependencies

- List key dependencies here
```

**Guidelines:**
- Keep generic and under 80 lines
- List each phase with status/progress
- Link to detailed phase files
- Key dependencies

### Multi-Machine Plans (`/rig:remote`)

When phases run on other machines, plan.md gets `branch:` (`orchestrator:` is written later by `remote dispatch`, never by the planner); each remote phase gets `machine`, `owns` (required, disjoint between machines), optional `dependsOn`. Order phases so each machine's phases are contiguous and dependencies precede dependents. Success Criteria of a remote phase names that machine's test command. `reviewedSha`/`reviewScore` are set later by the orchestrator, never at planning time. Field reference: `output-standards.md` -> Multi-Machine Fields.

### Phase Files (phase-XX-name.md)
Fully respect the `./docs/development-rules.md` file.
Each phase file should contain:

**Context Links**
- Links to related reports, files, documentation

**Overview**
- Priority
- Current status
- Brief description

**Key Insights**
- Important findings from research
- Critical considerations

**Requirements**
- Functional requirements
- Non-functional requirements

**Architecture**
- System design
- Component interactions
- Data flow

**Related Code Files**
- List of files to modify
- List of files to create
- List of files to delete

**Implementation Steps**
- Detailed, numbered steps
- Specific instructions

**Todo List**
- Checkbox list for tracking

**Success Criteria**
- Definition of done
- Validation methods

**Risk Assessment**
- Potential issues
- Mitigation strategies

**Security Considerations**
- Auth/authorization
- Data protection

**Next Steps**
- Dependencies
- Follow-up tasks
