---
name: docs
description: "Analyze codebase and manage project documentation — init, update, summarize, restructure (reorganize non-standard docs into the Diataxis layout)."
argument-hint: "init|update|summarize|restructure"
metadata:
  author: rig
  version: "1.0.0"
---

# Documentation Management

Analyze codebase and manage project documentation through exploration, analysis, and structured doc generation.

**IMPORTANT:** Invoke "/project-organization" skill to organize the outputs.

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available documentation operations:

| Operation | Description |
|-----------|-------------|
| `init` | Analyze codebase & create initial docs |
| `update` | Analyze changes & update docs |
| `summarize` | Quick codebase summary |
| `restructure` | Reorganize existing docs into the Diataxis layout |

Present as options via `AskUserQuestion` with header "Documentation Operation", question "What would you like to do?".

## Subcommands

| Subcommand | Reference | Purpose |
|------------|-----------|---------|
| `/docs init` | `references/init-workflow.md` | Analyze codebase and create initial documentation |
| `/docs update` | `references/update-workflow.md` | Analyze codebase and update existing documentation |
| `/docs summarize` | `references/summarize-workflow.md` | Quick analysis and update of codebase summary |
| `/docs restructure` (alias `refactor`) | `references/restructure-workflow.md` | Classify, move, split, and index docs that do not follow the standard layout |

## Routing

Parse `$ARGUMENTS` first word:
- `init` → Load `references/init-workflow.md`
- `update` → Load `references/update-workflow.md`
- `summarize` → Load `references/summarize-workflow.md`
- `restructure` or `refactor` → Load `references/restructure-workflow.md`
- empty/unclear → AskUserQuestion (do not auto-run `init`)

## Shared Context

Documentation lives in `./docs`, organized by Diataxis type:
```
./docs
├── README.md        # index, grouped by type
├── tutorials/       # learning (only when real content exists)
├── how-to/          # deploy.md, task guides
├── reference/       # code-standards.md, codebase-summary.md, design-guidelines.md
├── explanation/     # architecture.md, decisions/ (ADRs)
└── project/         # overview-pdr.md, roadmap.md, changelog.md
```

See `references/diataxis-docs-layout.md` for type rules, naming, and the legacy → new path map.
`docs-maintainer` MUST activate the `diataxis-writer` skill and follow its "Diataxis Workflow" for every page.

Use `docs/` directory as the source of truth for documentation.

**IMPORTANT**: **Do not** start implementing code.
