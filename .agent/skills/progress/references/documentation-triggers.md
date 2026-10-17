# Documentation Triggers

## When to Update Docs

MUST update project documentation in `./docs` when:

| Trigger | Which Docs | Action |
|---------|-----------|--------|
| Phase status changes | project/roadmap.md | Update progress %, milestone status |
| Major feature complete | project/roadmap.md, reference/codebase-summary.md | Add feature, update architecture |
| Bug fix (significant) | project/roadmap.md | Document fix, severity, impact |
| Security patch | project/roadmap.md, explanation/architecture.md | Record improvement |
| API contract changes | explanation/architecture.md, reference/code-standards.md | Update endpoints, schemas |
| Architecture decision | explanation/architecture.md | Document decision + rationale |
| Scope/timeline change | project/roadmap.md | Adjust phases, dates |
| Dependencies updated | explanation/architecture.md | Record version changes |
| Breaking changes | reference/code-standards.md | Document migration path |

## Documentation Files

```
./docs/
├── README.md          # Diataxis index
├── tutorials/         # learning paths (only if needed)
├── how-to/            # task guides (deploy.md)
├── reference/         # code-standards.md, codebase-summary.md, design-guidelines.md
├── explanation/       # architecture.md, decisions/ (ADRs)
└── project/           # overview-pdr.md, roadmap.md, changelog.md
```

Write to the new paths; if the project still uses the legacy flat layout (e.g. `docs/project-roadmap.md`), update the legacy file instead of creating a duplicate.

## Update Protocol

1. **Read current state:** Always read target doc before editing
2. **Analyze reports:** Review agent reports in plan reports directory
3. **Update content:** Modify progress %, statuses, dates, descriptions
4. **Cross-reference:** Ensure consistency across docs
5. **Validate:** Verify dates, versions, references accurate

## Quality Standards

- **Consistency:** Same formatting, versioning across all docs
- **Accuracy:** Progress %, dates, statuses reflect reality
- **Completeness:** Sufficient detail for stakeholder communication
- **Timeliness:** Update within same session as significant changes
- **Traceability:** Clear links between roadmap items and implementation

## Delegation Pattern

Use `docs-maintainer` subagent for documentation updates:

```
Task(
  subagent_type: "docs-maintainer",
  prompt: "Update ./docs for [changes]. Work context: [path]",
  description: "Update docs"
)
```

Progress tracker coordinates WHEN to update; docs-maintainer handles HOW.
