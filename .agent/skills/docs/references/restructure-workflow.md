# Restructure Workflow

Reorganize an existing `docs/` that does not follow the Diataxis layout (`references/diataxis-docs-layout.md`): classify every page, move, split, and index it. This is a structure change only: keep content and facts as they are. Fixing stale content is `/docs update`'s job, run it afterwards.

Aliases: `/docs restructure`, `/docs refactor`. An optional path after the subcommand names the docs dir (default `docs/`).

## Phase 0: Preflight

1. Docs dir missing or holds no `.md` pages → stop and suggest `/docs init`.
2. Run `git status --porcelain -- docs README.md`. Uncommitted changes → `AskUserQuestion` header "Dirty Tree": **Commit first (Recommended)** / **Continue anyway** / **Cancel**. Moves use `git mv`, so a clean tree keeps the result easy to review and revert.
3. Run `node .agent/scripts/validate-docs.cjs docs/` and keep the Layout section. No layout warnings, no page over `docs.maxLoc` (session context, default 800), and `docs/README.md` exists → report "already Diataxis" and stop.

## Phase 1: Inventory and Classification

1. List pages with LOC: `find docs -name '*.md' -not -path '*/devlog/*' -not -path '*/assets/*' -not -path '*/research/*' -not -path '*/infographics/*' | xargs wc -l | sort -rn`
2. For each page run `bash .agent/skills/diataxis-writer/scripts/classify-doc.sh <file>` (advisory signals only).
3. Read the pages. 1-6 pages: read directly. 7+ pages: spawn 2-5 `Explore` agents (you spawn them, subagents cannot), split by LOC. Prompt each: "For each file give: reader job, primary Diataxis type (tutorial/how-to/reference/explanation/project), sections of another type with heading names, suggested kebab-case name. Files: {list}".
4. Decide, per page, using the reader-job test in the layout ref (the classifier is a hint; the reader job decides):
   - **keep**: already in the right dir with a good name
   - **move**: one primary type → `<type-dir>/<name>.md` (legacy map pages use their mapped target)
   - **split**: mixed types or over `docs.maxLoc` → list the new pages and which headings go where
   - **merge**: two pages on the same subject and type (e.g. two roadmaps) → target page
   - **leave**: `devlog/`, `assets/`, `research/`, `infographics/`, generated files
   A whole folder of one type (e.g. `guides/` of how-tos) may move as a dir: `guides=how-to`, but only when the target dir does not exist yet; otherwise map its files one by one.

## Phase 2: Restructure Plan (Approval Gate)

1. Write the plan to the reports path as `docs-restructure-{date}-{slug}.md`: a table `Page | LOC | Type | Action | Target`, then split details, merges, and the exact migrator command.
2. Dry-run the moves (legacy moves are included automatically; add one `--map` per non-legacy move, paths relative to the docs dir):
   `node .agent/scripts/migrate-docs-to-diataxis-layout.cjs docs/ --map setup.md=tutorials/getting-started.md --map guides=how-to`
   Fix any conflict or rejected `--map` before asking.
3. `AskUserQuestion` header "Restructure", show the table: **Apply plan (Recommended)** / **Moves only, no splits** / **Cancel**. Do not touch files before the answer. No `AskUserQuestion` (headless run) and no approval in the request → print the table and the three options, then STOP. Never treat a missing answer as approval.

## Phase 3: Moves

1. Run the Phase 2 command with `--apply`. It moves with `git mv` and rewrites inbound links (docs pages, root `README.md`/`CLAUDE.md`/`AGENTS.md`), outbound relative links, and plain `docs/...` mentions.
2. Stop on "partial state" errors and report what moved.

## Phase 4: Splits, Merges, Index (docs-maintainer Agent)

**CRITICAL:** Spawn `docs-maintainer` via Task tool with the approved plan file. Instruct it to:
- Split each mixed/oversized page per the plan along type lines; move text, do not rewrite facts; cross-link the new pages.
- Merge pages per the plan, then delete the leftover file and fix links pointing to it.
- Create or update `docs/README.md` with the index template from the layout ref.
- Skip splits if the user chose "Moves only".
- Not edit the docs tree in `CLAUDE.md`/`AGENTS.md` (owned by the user).

## Phase 5: Verify and Report

1. `node .agent/scripts/validate-docs.cjs docs/` → 0 broken internal links, 0 layout warnings. Fix and re-run if not.
2. Phase 1 LOC command → no page over `docs.maxLoc`.
3. `git grep -n -F '<old path>'` for each moved page outside `docs/` (code comments, CI config, other markdown) → list hits; the migrator only rewrites docs and root files.
4. Report: moves, splits, merges, remaining warnings, hits from step 3. Suggest two commits: renames first (`git commit` with only the staged moves), content second, so `git log --follow` keeps history. Do not commit unless asked.

## Additional requests
<additional_requests>
  $ARGUMENTS
</additional_requests>

## Important
- Approval gate is mandatory: no moves, splits, or index writes without an explicit "Apply plan" or "Moves only" answer (or the same words in the request).
- Structure only: no new facts, no deleted content (except merged duplicates).
- **Do not** start implementing code.
