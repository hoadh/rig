---
name: project-organization
description: Organize files, directories, and content structure in any project. Use when creating files, determining output paths, organizing existing assets, or standardizing project layout.
argument-hint: "[directories or files to organize]"
metadata:
  author: rig
  version: "1.0.0"
user-invocable: false
---

# Project Organization

Standardize file locations, naming conventions, directory structures, and markdown content templates for any project type.

## When to Use

- Creating any file that needs a consistent output path
- Organizing existing project files and directories
- Determining where to save plans, reports, docs, assets, tests
- Enforcing naming conventions across the project
- Structuring markdown content (plans, devlog, reports, docs)

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Advisory** | Other skills/agents reference this skill | Return correct path + naming for requested file type |
| **Organize** | User invokes directly with dirs/files | Scan → propose changes → execute after confirm |

## Core Rules

### Rule 1 — Directory Categories

Every project file belongs to one of these top-level categories:

| Category | Path | Purpose |
|----------|------|---------|
| Source code | `src/` or project root | Application code (language-specific, not managed here) |
| Documentation | `docs/` | Human & AI readable docs, guides, specs |
| Plans | `plans/` | Implementation plans, research, agent reports |
| Tests | `tests/` or `test/` | Test suites (unit, integration, e2e) |
| Scripts | `scripts/` | Build, deploy, utility scripts |
| Assets | `assets/{type}/` | Media, branding, designs, generated content |
| Config | Root or `.config/` | dotfiles, config files, env files |
| Guides | `guide/` or `guides/` | User-facing reference docs, tutorials |

**Subcategories within each:**

```
docs/
├── devlog/                    # Devlog: shipped work, decisions, lessons
├── explanation/decisions/     # ADRs (Architecture Decision Records)
└── tutorials/ how-to/ reference/ explanation/ project/   # Diataxis docs

plans/
├── {date-slug}/               # Timestamped plan folders
│   ├── plan.md                # Overview
│   ├── phase-{NN}-{name}.md   # Phase details
│   ├── research/              # Research materials for this plan
│   └── reports/               # Agent reports scoped to this plan
├── reports/                   # Standalone agent reports (not plan-scoped)
└── visuals/                   # Generated diagrams, previews

assets/
├── images/                    # Static images, screenshots
├── videos/                    # Video files
├── designs/                   # UI/UX designs, mockups
├── branding/                  # Logos, brand assets
├── generated/                 # AI-generated content
└── {custom-type}/             # Project-specific asset categories
```

### Rule 2 — Naming Patterns

All filenames use **kebab-case**, self-documenting names.

**Three naming modes based on content temporality:**

| Mode | Pattern | When to use | Examples |
|------|---------|-------------|---------|
| **Timestamped** | `{YYMMDD-HHmm}-{slug}` | Time-sensitive: plans, reports, devlog, sessions | `260304-1530-auth-plan` |
| **Evergreen** | `{slug}` | Stable docs, configs, guides | `explanation/architecture.md` |
| **Variant** | `{slug}-{variant}.{ext}` | Multiple versions of same asset | `logo-dark.svg`, `hero-1920x1080.png` |

**Slug rules:**
- Lowercase, hyphens only (no underscores, spaces, special chars)
- Max 50 chars (truncate at word boundary)
- Self-documenting: readable without opening the file
- No leading/trailing hyphens

**Date format:** Use `$RIG_PLAN_DATE_FORMAT` env var or default `YYMMDD-HHmm`.

```bash
date +%y%m%d-%H%M   # Bash
```

**Code file naming:** Follow the File Naming rule in `.agent/rules/development-rules.md` — kebab-case for JS/TS/Python/Shell, PascalCase for C#/Java/Swift, snake_case for Go/Rust.

### Rule 3 — Nesting Logic

Decide between flat file vs folder based on output count:

| Scenario | Pattern | Example |
|----------|---------|---------|
| Single file output | Flat file in category dir | `docs/devlog/260304-session-review.md` |
| Multi-file output | Self-contained subdirectory | `plans/260304-auth-impl/plan.md` + `phase-01-*.md` |
| Scoped to parent | Nested under parent context | `plans/260304-auth-impl/reports/explore-report.md` |
| Platform-specific | Platform subdirectory | `assets/posts/twitter/`, `assets/posts/linkedin/` |
| Variant-based | Flat with variant suffix | `assets/branding/logo-light.svg`, `logo-dark.svg` |

**Empty directories:** Add `.gitkeep` to preserve in git.

### Rule 4 — Markdown Body Standards

Every markdown file MUST have consistent structure based on its type.

**Universal rules for all markdown:**
- Start with a `# Title` (H1)
- Use frontmatter (`---`) for metadata when the file is consumed by tools
- Keep sections ordered: context → content → next steps
- Use tables for structured data, lists for sequences
- Sacrifice grammar for concision

**Quick reference — required sections by type:**

| Type | Key sections |
|------|-------------|
| **Plan** | frontmatter → overview → phases with status → dependencies → success criteria |
| **Phase** | context links → overview → requirements → architecture → impl steps → todo checklist → risks |
| **Report** | frontmatter → summary → findings → recommendations → unresolved questions |
| **Devlog** | frontmatter → context → what happened → reflection → decisions → next |
| **Doc** | title → overview → content sections → references |
| **ADR** | status → context → decision → consequences → alternatives considered |
| **Changelog** | version blocks → categories (added/changed/fixed/removed/deprecated) |
| **README** | name → badges → description → quick start → usage → contributing → license |
| **Guide** | title → prerequisites → step-by-step → troubleshooting → FAQ |
| **Spec** | overview → requirements → constraints → API/interface → acceptance criteria |

Load: `references/markdown-body-templates.md` for full templates.

### Rule 5 — Path Resolution Decision Tree

When creating a new file, follow this decision tree:

```
1. Is it source code?
   → YES: src/ or project root (follow language conventions)
   → NO: continue

2. Is it a test?
   → YES: tests/ (mirror source structure)
   → NO: continue

3. Is it an implementation plan or agent output?
   → Plan: plans/{date-slug}/
   → Agent report (plan-scoped): plans/{date-slug}/reports/
   → Agent report (standalone): plans/reports/
   → Research: plans/{date-slug}/research/ or plans/research/
   → NO: continue

4. Is it documentation for humans/AI?
   → Devlog: docs/devlog/{date-slug}.md
   → Architecture decision: docs/explanation/decisions/{date-slug}.md
   → Evergreen doc: docs/{slug}.md
   → NO: continue

5. Is it a media/design/brand asset?
   → assets/{type}/{naming-per-rule-2}
   → NO: continue

6. Is it a utility script?
   → scripts/{slug}.{ext}
   → NO: continue

7. Is it configuration?
   → Root or .config/ (follow ecosystem conventions)
```

## Organize Mode Actions

When invoked directly with `/project-organization [targets]`:

1. **Scan** — List all files in target dirs, categorize by type
2. **Analyze** — Check naming violations, misplaced files, inconsistencies
3. **Propose** — Present a migration plan (from → to) as a table
4. **Confirm** — Ask user approval before any moves
5. **Execute** — Move/rename files, create missing directories
6. **Verify** — List final structure, flag any remaining issues

**Safety:**
- Never overwrite existing files (prompt on conflict)
- Never touch `.git/`, `node_modules/`, `.env` files
- Create backups when renaming (git handles this)
- Respect `.gitignore` patterns

## File Type Reference

Load: `references/directory-patterns.md` for detailed patterns per category.
Load: `references/naming-conventions.md` for slug generation, date formats, variant naming.

## Integration

This skill is the **single source of truth** for file organization.
Other skills reference it when determining output paths:

- `plan` / `brainstorm` → plans/ structure
- `devlog` → docs/devlog/
- `implement` / `fix` → source code paths (defer to language conventions)
- `test` → tests/ structure
- `docs` / `docs-maintainer` → docs/ structure
- `explore` / `research` → plans/reports/ or plans/{plan}/research/
- `code-review` → plans/reports/
- `progress` → docs/ + plans/
- `ui-ux-designer` → assets/designs/
- `media` → assets/generated/
- `git` → respects all naming conventions
- `development-rules.md` File Naming rule → code file naming (JS/TS/Python/Shell = kebab-case)

## Pre-Output Checklist

Before writing any file:
1. Determine category → get base path (Rule 1)
2. Choose naming mode → timestamped/evergreen/variant (Rule 2)
3. Decide nesting → flat or subdirectory (Rule 3)
4. Apply body template if markdown (Rule 4)
5. Check if file/folder exists (avoid overwrite)
6. Create directory structure if needed
