# Unified Workflow Steps

All modes share core steps with mode-specific variations.

**Tasks API (optional):** `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` are off by default. Create tasks only if `TaskCreate` is available; otherwise track progress in the phase files. All workflow steps work without them.

## Step 0: Intent Detection & Setup

1. Parse input with `intent-detection.md` rules
2. Log detected mode: `✓ Step 0: Mode [X] - [reason]`
3. If mode=code: detect plan path, set active plan
4. Use `TaskCreate` to create workflow step tasks (with dependencies if complex)

**Output:** `✓ Step 0: Mode [interactive|auto|fast|parallel|no-test|code] - [detection reason]`

## Step 1: Research (skip if fast/code mode)

**Interactive/Auto:**
- Spawn multiple `researcher` agents in parallel
- Use `/explore ext` or `Explore` subagents for codebase search
- Keep reports ≤150 lines

**Parallel:**
- Optional: max 2 researchers if complex

**Output:** `✓ Step 1: Research complete - [N] reports gathered`

### [Review Gate 1] Post-Research (skip if auto mode)
- Present research summary to user
- Use `AskUserQuestion` to ask: "Proceed to planning?" / "Request more research" / "Abort"
- **Auto mode:** Skip this gate

## Step 2: Planning

**Interactive/Auto/No-test:**
- Use `planner` agent with research context
- Create `plan.md` + `phase-XX-*.md` files

**Fast:**
- Use `/plan --fast` with explore results only
- Minimal planning, focus on action

**Parallel:**
- Use `/plan --parallel` for dependency graph + file ownership matrix

**Code:**
- Skip - plan already exists
- Parse existing plan for phases

**Output:** `✓ Step 2: Plan created - [N] phases`

### [Review Gate 2] Post-Plan (skip if auto mode)
- Present plan overview with phases
- Use `AskUserQuestion` to ask: "Validate the plan or approve plan to start implementation?" - "Validate" / "Approve" / "Abort" / "Other" ("Request revisions")
  - "Validate": run `/plan validate` skill invocation
  - "Approve": continue to implementation
  - "Abort": stop the workflow
  - "Other": revise the plan based on user's feedback
- **Auto mode:** Skip this gate

## Step 3: Implementation

Before starting:
1. If `TaskList` is available, check for existing tasks (hydrated by planning skill in same session); otherwise read the phase files
2. If tasks exist → pick them up, skip re-creation
3. If no tasks and `TaskCreate` is available → read plan phases and create one task per unchecked `[ ]` item with priority order and metadata (`phase`, `planDir`, `phaseFile`); otherwise track in the phase files
4. Tasks can be blocked by other tasks via `addBlockedBy`

**All modes:**
- Use `TaskUpdate` to mark tasks as `in_progress` immediately.
- Execute phase tasks sequentially (Step 3.1, 3.2, etc.)
- Use `ui-ux-designer` for frontend
- Use `media` for image assets
- Run type checking after each file

**Parallel mode:**
- Utilize all tools of Claude Tasks: `TaskCreate`, `TaskUpdate`, `TaskGet` and `TaskList`
- Launch multiple `implementer` agents
- When agents pick up a task, use `TaskUpdate` to assign task to agent and mark tasks as `in_progress` immediately.
- Respect file ownership boundaries
- Wait for parallel group before next

**Output:** `✓ Step 3: Implemented [N] files - [X/Y] tasks complete`

**Multi-machine plans** (a phase has `machine:` other than this machine; plan has `orchestrator:`):
- Phases on this machine: unchanged. Commit and push before dispatching anything.
- Foreign-machine phase: follow `../remote/references/remote-implement-workflow.md` (`remote dispatch` -> `status --wait` in background -> `code-reviewer` on the fetched worker diff -> `remote review`; `dispatch --resume` at most 3 times, then ask the user).
- Before Step 4 run `remote collect <plan-dir> --test <machine>=<cmd>` so tests run on the integration branch; Step 4 then covers this machine's tests.
- Plans without `machine:` fields skip all of this.

### [Review Gate 3] Post-Implementation (skip if auto mode)
- Present implementation summary (files changed, key changes)
- Use `AskUserQuestion` to ask: "Proceed to testing?" / "Request implementation changes" / "Abort"
- **Auto mode:** Skip this gate

## Step 4: Testing (skip if no-test mode)

**All modes (except no-test):**
- Write tests: happy path, edge cases, errors
- Tests must run and pass; a failing suite is never waved through (it hides a regression).
- Large tier: spawn `tester` (`Agent(subagent_type="tester", prompt="Run test suite", description="Run tests")`); on failures spawn `debugger`, fix, repeat. Standard tier: run the suite in the main session.
- Forbidden: fake mocks, commented-out tests, weakened assertions

**Output:** `✓ Step 4: Tests [X/X passed] - [tester subagent invoked | run in main session]`

### [Review Gate 4] Post-Testing (skip if auto mode)
- Present test results summary
- Use `AskUserQuestion` to ask: "Proceed to code review?" / "Request test fixes" / "Abort"
- **Auto mode:** Skip this gate

## Step 5: Code Review

**All modes (Standard: one pass, only if logic changed; Large: required gate):**
- Spawn `code-reviewer`: `Agent(subagent_type="code-reviewer", prompt="Review changes in [diff range]. Plan: [phase file]. Test results: [command, pass/fail counts, commit]. Lint/build: [results]. Return score, critical issues, warnings.", description="Code review")`
- The prompt carries the Step 4 results so the reviewer does not re-run the suites; each fix cycle spawns a new reviewer (`orchestration-protocol.md` "Review")
- Do not self-review the code you just wrote; an independent reviewer is the point of this gate

**Interactive/Parallel/Code/No-test:**
- Interactive cycle (max 3): see `review-cycle.md`
- Requires user approval

**Auto:**
- Auto-approve if score≥9.5 AND 0 critical
- Auto-fix critical (max 3 cycles)
- Escalate to user after 3 failed cycles

**Fast:**
- Simplified review, no fix loop
- User approves or aborts

**Output:** `✓ Step 5: Review [score]/10 - [Approved|Auto-approved] - code-reviewer subagent invoked`

## Step 6: Finalize

**Scales with tier (see "Gates by Tier" in `../SKILL.md`):**
1. Spawn in parallel, only what applies:
   - `progress-tracker` when a plan exists: `Agent(subagent_type="progress-tracker", prompt="Run full sync-back for [plan-path]: reconcile all completed work (and Claude Tasks, if the Tasks API is available) with all phase files, backfill stale completed checkboxes across every phase, then update plan.md frontmatter/table progress. Do not only mark current phase.", description="Update plan")`
   - `docs-maintainer` when docs impact is not none: `Agent(subagent_type="docs-maintainer", prompt="Update docs for changes.", description="Update docs")`
2. Progress-tracker sync-back includes:
### Status Sync (Finalize)

Edit plan.md directly — set the Status column cell to `Completed` / `In Progress` / `Pending`,
preserve table structure.
Exception: never set `Completed` for a phase with open `- [ ] LIVE:` / `LIVE(blocking):` items (Pending Live Verification); keep `In Progress`.
   - Sweep all `phase-XX-*.md` files in the plan directory.
   - Mark every completed item `[ ] → [x]` based on completed tasks (including earlier phases finished before current phase).
   - Update `plan.md` status/progress (`pending`/`in-progress`/`completed`) from actual checkbox state.
   - Return unresolved mappings if any completed task cannot be matched to a phase file.
3. Use `TaskUpdate` to mark Claude Tasks complete after sync-back confirmation.
4. Onboarding check (API keys, env vars)
5. Commit only when the user asks (or the flow says so), via git subagent: `Agent(subagent_type="git-operator", prompt="Stage and commit changes", description="Commit")`

Large tier: skipping the applicable subagents leaves the plan and docs out of sync, so Step 6 is incomplete without them.

**Auto mode:** Continue to next phase automatically, start from **Step 3**.
**Others:** Ask user before next phase

**Output:** `✓ Step 6: Finalized - [N] subagents invoked - Full-plan sync-back completed - Committed`

## Mode-Specific Flow Summary

Legend: `[R]` = Review Gate (human approval required)

```
interactive: 0 → 1 → [R] → 2 → [R] → 3 → [R] → 4 → [R] → 5(user) → 6
auto:        0 → 1 → 2 → 3 → 4 → 5(auto) → 6 → next phase (NO stops)
fast:        0 → skip → 2(fast) → [R] → 3 → [R] → 4 → [R] → 5(simple) → 6
parallel:    0 → 1? → [R] → 2(parallel) → [R] → 3(multi-agent) → [R] → 4 → [R] → 5(user) → 6
no-test:     0 → 1 → [R] → 2 → [R] → 3 → [R] → skip → 5(user) → 6
code:        0 → skip → skip → 3 → [R] → 4 → [R] → 5(user) → 6
```

**Key difference:** `auto` mode is the only mode that skips all review gates.

## Critical Rules

- Never skip steps without mode justification
- Subagent delegation scales with tier (see `../SKILL.md` "Gates by Tier"): Large spawns `tester`, `code-reviewer`, and the applicable finalize agents; Standard runs tests in the main session with one review pass.
- Create tasks only if `TaskCreate` is available (one per unchecked item, with priority order and dependencies); otherwise track in the phase files.
- If tasks exist, mark them `in_progress` when picking up work.
- If tasks exist, mark them `completed` right after finalizing; otherwise tick the phase-file checkbox.
- All step outputs follow format: `✓ Step [N]: [status] - [metrics]`
- **VALIDATION:** If Agent tool calls = 0 at end of workflow, the workflow is INCOMPLETE.
