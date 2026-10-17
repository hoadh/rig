# Diataxis Docs Layout

Standard `docs/` layout for Rig projects. Each page has ONE primary Diataxis type and lives in that type's directory.
Code source of truth for the legacy map: `.agent/scripts/docs-diataxis-layout.cjs`.

## Layout

```
docs/
├── README.md                     # Index (required): links every page, grouped by type
├── tutorials/                    # Learning: guided lesson for newcomers (only when real content exists)
│   └── getting-started.md
├── how-to/                       # Doing: task steps for a competent user
│   └── deploy.md
├── reference/                    # Looking up: facts, structure, rules
│   ├── code-standards.md
│   ├── codebase-summary.md
│   └── design-guidelines.md
├── explanation/                  # Understanding: why, trade-offs, design
│   ├── architecture.md
│   └── decisions/                # ADRs
├── project/                      # Project management (not a Diataxis type)
│   ├── overview-pdr.md
│   ├── roadmap.md
│   └── changelog.md
└── devlog/ assets/ research/ infographics/   # Untouched: not reader docs
```

## Legacy → New Paths

| Legacy (flat) | New |
|---|---|
| `docs/code-standards.md` | `docs/reference/code-standards.md` |
| `docs/codebase-summary.md` | `docs/reference/codebase-summary.md` |
| `docs/design-guidelines.md` | `docs/reference/design-guidelines.md` |
| `docs/system-architecture.md` | `docs/explanation/architecture.md` |
| `docs/deployment-guide.md` | `docs/how-to/deploy.md` |
| `docs/project-overview-pdr.md` | `docs/project/overview-pdr.md` |
| `docs/project-roadmap.md`, `docs/development-roadmap.md` | `docs/project/roadmap.md` |
| `docs/project-changelog.md` | `docs/project/changelog.md` |
| `docs/decisions/` | `docs/explanation/decisions/` |

Only these pairs are moved automatically. Other root pages: classify by reader job and move by hand.

## Type Rules

| Reader job | Type | Directory | Test |
|---|---|---|---|
| Learn by doing, first time | Tutorial | `tutorials/` | Guaranteed path, one result, no choices |
| Get a task done | How-to | `how-to/` | Starts from a goal, numbered steps, assumes competence |
| Look up a fact | Reference | `reference/` | Neutral, complete, structured like the thing it describes |
| Understand why | Explanation | `explanation/` | Context, alternatives, trade-offs, no steps |

- `project/` holds PDR, roadmap, changelog: planning records, not reader docs. Keep them out of the 4 types.
- Create `tutorials/` only when the project has onboarding steps worth a learning path. No empty dirs.
- A page that mixes types gets split (diataxis-writer "Mixed Documents"); pages cross-link each other.
- Oversized page: split along type lines first, then into sibling pages in the same type dir
  (e.g. `reference/code-standards.md` + `reference/naming-conventions.md`). No `docs/{topic}/index.md` trees.

## Naming

- kebab-case, no type prefix/suffix (the dir already says the type).
- How-to pages named by task: `how-to/rotate-api-keys.md`, `how-to/deploy.md`.
- Reference pages named by subject: `reference/cli-commands.md`.

## `docs/README.md` Index Template

```markdown
# Documentation

## Tutorials
- [Getting started](./tutorials/getting-started.md) - first working setup

## How-to guides
- [Deploy](./how-to/deploy.md) - release to production

## Reference
- [Code standards](./reference/code-standards.md) - conventions and rules

## Explanation
- [Architecture](./explanation/architecture.md) - how the system fits together

## Project
- [Overview & PDR](./project/overview-pdr.md) · [Roadmap](./project/roadmap.md) · [Changelog](./project/changelog.md)
```

Omit empty sections. Update the index whenever a page is added, moved, or removed.

## Readers: Legacy Fallback

Agents and skills that read docs name both paths explicitly:
"`docs/explanation/architecture.md` (legacy: `docs/system-architecture.md`)". Read the new path; if missing, read the legacy one.

## Migration

```bash
node .agent/scripts/migrate-docs-to-diataxis-layout.cjs docs/          # dry-run: prints planned moves
node .agent/scripts/migrate-docs-to-diataxis-layout.cjs docs/ --apply  # git mv + rewrite links
node .agent/scripts/validate-docs.cjs docs/                            # links + layout warnings
# pages outside the legacy map: one --map per move, paths relative to docs/
node .agent/scripts/migrate-docs-to-diataxis-layout.cjs docs/ --map setup.md=tutorials/getting-started.md --map guides=how-to
```

The migrator never overwrites an existing target (reported as conflict), and does not write `docs/README.md` or split pages: docs-maintainer does that. For a project whose docs follow no standard at all (ad-hoc names, mixed pages), run `/docs restructure`: it classifies every page, builds the `--map` list, asks for approval, then moves, splits, and indexes.
