# Update Workflow

## Phase 0: Legacy Layout Detection

1. Run `node .claude/scripts/migrate-docs-to-diataxis-layout.cjs docs/` (dry-run, changes nothing)
2. No moves listed → continue to Phase 1
3. Moves listed → `AskUserQuestion` header "Docs Layout", question "Migrate docs to Diataxis layout?", show the planned moves:
   - **Migrate now** → run the same command with `--apply`; in Phase 2 tell docs-maintainer to create `docs/README.md` and split mixed/oversized pages
   - **Keep legacy layout** → update docs in place at their legacy paths this time
4. Conflicts reported (target exists, or two legacy files share a target such as both roadmaps) → list them for the user; docs-maintainer merges the leftover legacy file into the target by hand, then deletes it
5. `validate-docs.cjs` reports "unclassified root doc" pages, or docs use their own ad-hoc structure → suggest `/rig:docs restructure` (classifies and moves every page) instead of updating in place

## Phase 1: Parallel Codebase Exploration

1. Scan the codebase and calculate the number of files with LOC in each directory (skip `.claude`, `.git`, `tests`, `node_modules`, `__pycache__`, `secrets`, etc.)
2. Target directories **that actually exist** - adapt to project structure
3. Activate `rig:explore` skill to explore the code base and return detailed summary reports
4. Merge explore reports into context summary

## Phase 1.5: Parallel Documentation Reading

**You (main agent) must spawn readers** - subagents cannot spawn subagents.

1. List docs: `find docs -name '*.md' -not -path '*/devlog/*' -not -path '*/assets/*' -not -path '*/research/*'`
2. Get LOC: pipe that list to `xargs wc -l 2>/dev/null | sort -rn`
3. Strategy:
   - 1-3 files: Skip parallel reading, docs-maintainer reads directly
   - 4-6 files: Spawn 2-3 `Explore` agents
   - 7+ files: Spawn 4-5 `Explore` agents (max 5)
4. Distribute files by LOC (larger files get dedicated agent)
5. Each agent prompt: "Read these docs, extract: purpose, key sections, areas needing update. Files: {list}"
6. Merge results into context for docs-maintainer

## Phase 2: Documentation Update (docs-maintainer Agent)

**CRITICAL:** You MUST spawn `docs-maintainer` agent via Task tool with merged reports and doc readings.

Pass the gathered context to docs-maintainer agent to update documentation (paths per `references/diataxis-docs-layout.md`; if the user kept the legacy layout, use the legacy paths):
- `README.md`: Update README (keep it under 300 lines)
- `docs/README.md`: Update the docs index
- `docs/project/overview-pdr.md`: Update project overview and PDR
- `docs/reference/codebase-summary.md`: Update codebase summary
- `docs/reference/code-standards.md`: Update codebase structure and code standards
- `docs/explanation/architecture.md`: Update system architecture
- `docs/project/roadmap.md`: Update project roadmap
- `docs/how-to/deploy.md` [optional]: Update deployment guide
- `docs/reference/design-guidelines.md` [optional]: Update design guidelines

Do not ask to rewrite the docs tree shown in `CLAUDE.md`/`AGENTS.md`; that tree belongs to the user.

## Additional requests
<additional_requests>
  $ARGUMENTS
</additional_requests>

## Phase 3: Size Check (Post-Update)

After docs-maintainer completes:
1. Run the Phase 1.5 LOC command to check sizes
2. Use `docs.maxLoc` from session context (default: 800)
3. For files exceeding limit: report and ask user

## Phase 4: Documentation Validation (Post-Update)

Run validation to detect potential hallucinations:
1. Run: `node .claude/scripts/validate-docs.cjs docs/`
2. Display validation report (warnings only, non-blocking)
3. Checks: code references, internal links, config keys, legacy/unclassified layout warnings
4. docs-maintainer runs `classify-doc.sh` on changed pages (advisory) per its Diataxis Workflow

## Important
- Use `docs/` directory as the source of truth.
- **Do not** start implementing.
