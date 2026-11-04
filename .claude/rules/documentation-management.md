# Project Documentation Management

Docs live in `./docs` (Diataxis layout, see `/rig:docs`). Key files: `project/roadmap.md`, `project/changelog.md`, `explanation/architecture.md`, `reference/code-standards.md`.

## When to Update
- Update docs when behavior, structure or public interfaces change: feature shipped, milestone reached, bug or security fix, scope change, breaking dependency change. Roadmap progress and changelog entries follow. Pure internal fixes (Trivial tier) need no doc changes.
- Read the current roadmap/changelog first, keep version and format consistent, and check links and dates afterwards.
- Large tier: delegate to `docs-maintainer`; `progress-tracker` updates plan status when a plan exists.

## Plans
Save plans in `./plans/{timestamp}-{slug}/` using the naming pattern injected by hooks.

```
plans/{timestamp}-{slug}/
├── research/   reports/
├── plan.md                    # overview, under 80 lines: phases, status, links, dependencies
└── phase-XX-name.md           # one file per phase
```

Each phase file contains these sections, in order, so they stay easy to scan and move:
- **Context Links**, **Overview** (priority, status, summary), **Key Insights**
- **Requirements** (functional, non-functional), **Architecture**
- **Related Code Files** (modify / create / delete)
- **Implementation Steps** (numbered), **Todo List** (checkboxes)
- **Success Criteria** (definition of done, validation)
- **Pending Live Verification** (optional): `- [ ] LIVE: <behavior> — trigger: <condition> — evidence: <pointer>` for behavior provable only in production; `LIVE(blocking):` for items dependents need. Open items keep the phase `In Progress` (never `Completed`), are excluded from progress %, and evidence is a pointer, not raw logs.
- **Risk Assessment**, **Security Considerations**, **Next Steps**
