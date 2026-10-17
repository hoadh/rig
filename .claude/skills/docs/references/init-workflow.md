# Init Workflow

## Phase 1: Parallel Codebase Exploration

1. Scan the codebase and calculate the number of files with LOC in each directory (skip credentials, cache or external modules directories, such as `.claude`, `.git`, `tests`, `node_modules`, `__pycache__`, `secrets`, etc.)
2. Target directories **that actually exist** - adapt to project structure, don't hardcode paths
3. Activate `rig:explore` skill to explore the code base and return detailed summary reports to the main agent
4. Merge explore reports into context summary

## Phase 2: Documentation Creation (docs-maintainer Agent)

**CRITICAL:** You MUST spawn `docs-maintainer` agent via Task tool with merged reports. Do not wait for user input.

Pass the gathered context to docs-maintainer agent to create initial documentation in the Diataxis layout (`references/diataxis-docs-layout.md`):
- `README.md`: Update README with initial documentation (keep it under 300 lines)
- `docs/README.md`: Docs index, grouped by type
- `docs/project/overview-pdr.md`: Project overview and PDR (Product Development Requirements)
- `docs/reference/codebase-summary.md`: Codebase summary
- `docs/reference/code-standards.md`: Codebase structure and code standards
- `docs/explanation/architecture.md`: System architecture
- `docs/project/roadmap.md`: Project roadmap
- `docs/how-to/deploy.md` [optional]: Deployment guide
- `docs/reference/design-guidelines.md` [optional]: Design guidelines
- `docs/tutorials/getting-started.md` [optional]: Only if the project has onboarding steps worth a learning path

## Phase 3: Size Check (Post-Generation)

After docs-maintainer completes:
1. Run `find docs -name '*.md' -not -path '*/devlog/*' -not -path '*/assets/*' -not -path '*/research/*' | xargs wc -l 2>/dev/null | sort -rn` to check LOC
2. Use `docs.maxLoc` from session context (default: 800)
3. For files exceeding limit:
   - Report which files exceed and by how much
   - docs-maintainer should have already split proactively
   - If still oversized, ask user: split now or accept as-is?
